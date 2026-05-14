# GundamBase — Agent Handoff & Progress Document

> Use this file to orient yourself before touching the code. Read CLAUDE.md first for project structure, then use this document to understand what has been built, where things live, and what the active state of the codebase is.

---

## Current Branch: `wishlist`

All recent work lives on the `wishlist` branch. It has not yet been merged to `master`. It is ahead of `origin/wishlist` by several commits and needs to be pushed and deployed.

**Deploy sequence:**
```bash
# Local
git push origin wishlist

# On server (BitwerksWeb2)
git fetch origin
git checkout wishlist
pm2 restart gundambase
```

---

## What Has Been Built (Session History)

### 1. Claude Haiku Vision Scanner (replaces Ollama/moondream)
- **Commit:** `08bfeb3`
- **What:** Box photo scanning now uses `claude-haiku-4-5` via `@anthropic-ai/sdk` with `tool_use` (structured extraction). Replaced a local Ollama/moondream setup that was slow and often hallucinated RX-78-2 for every scan.
- **Why tool_use:** `output_config.format` with `json_schema` silently drops the image when combined with vision in some SDK versions. `tool_use` with `tool_choice: { type: 'tool', name: '...' }` is reliable.
- **Key file:** `server.js` — `POST /api/scan-box` (~line 330)
- **Image size:** Resized to 1024×1024 before sending (was 512, bumped for better text recognition)
- **HEIC support:** iPhones upload HEIC; converted to JPEG via `heic-convert` (pure JS, no system codec dependency) before passing to `sharp`

### 2. Scan Console Animation
- **Commit:** `807a801`, `aee1321`
- **What:** Terminal-style animated overlay during scan — green monospace text, blinking cursor, progressive messages fading in.
- **Key files:**
  - `public/app.js` — `startScanConsole()`, `stopScanConsole()`, `SCAN_MESSAGES[]`
  - `public/style.css` — `.scan-console`, `.scan-console-line`, `@keyframes scanLineFade`, `@keyframes scanBlink`
- **Pattern:** `setInterval` stored in `window._scanInterval`; cleared in `resetScanSection()` and `stopScanConsole()`

### 3. Wishlist Feature
- **Commits:** `893c350`, `e515446`
- **What:** Separate `/wishlist` page with priority tiers, source/retailer tracking, Claude Vision scanning, and a promote-to-inventory flow.

#### Data
- `data/wishlist.json` — array of wishlist items, same git-tracked pattern as `inventory.json`
- Item schema:
  ```json
  {
    "id": "wish-1234567890",
    "grade": "MG",
    "name": "Nu Gundam Ver.Ka",
    "series": "Char's Counterattack",
    "modelNumber": "RX-93",
    "source": "Amazon",
    "priority": "high",
    "thumbnail": "/uploads/thumbnails/wish-xxx-auto.jpg",
    "wikiTitle": "MG Nu Gundam Ver.Ka",
    "notes": "",
    "addedAt": "2026-04-30T..."
  }
  ```
- Priority values: `"high"` | `"medium"` | `"low"`

#### Server Routes (all in `server.js`)
| Route | Purpose |
|-------|---------|
| `GET /wishlist` | Serves `public/wishlist.html` |
| `GET /api/wishlist` | Returns all wishlist items |
| `POST /api/wishlist` | Add item |
| `PATCH /api/wishlist/:id` | Update item fields |
| `DELETE /api/wishlist/:id` | Remove item + clean up thumbnail file |
| `POST /api/wishlist/:id/upload/:type` | Upload thumbnail (reuses inventory multer middleware) |
| `POST /api/wishlist/:id/fetch-image` | Auto-fetch wiki thumbnail (preserves custom photos) |
| `POST /api/scan-wishlist` | Claude Vision scan — extracts name, grade, series, modelNumber, **and source/retailer** |

#### Frontend Files
- `public/wishlist.html` — page shell, add modal, item detail modal
- `public/wishlist.js` — all wishlist logic (fetch, render, scan, promote, delete)

#### Promote Flow (wishlist → inventory)
1. User clicks "Promote to Inventory →" on a wishlist item detail modal
2. Two-click confirm to prevent accidents
3. On confirm: `DELETE /api/wishlist/:id`, then `sessionStorage.setItem('promoteKit', JSON.stringify({...}))`
4. `window.location.href = '/'`
5. `public/app.js` init checks sessionStorage on load — if `promoteKit` is found, opens the Add modal pre-filled with the kit data, then clears the key

#### Navigation
- **Desktop:** `"♡ Wishlist"` outlined button in collection page header (`.wishlist-nav-btn` class, hidden on mobile via media query)
- **Mobile:** 4-tab bottom nav on collection page — Collection | + | Wishlist | Stats; wishlist tab is an `<a href="/wishlist">` link
- **Wishlist page mobile nav:** 3 tabs — Collection (link back to `/`) | + | Wishlist (active)

### 4. Gundam Wiki Link
- **Commits:** `a36b0dd`, `d8aeed9`
- **What:** Every kit detail modal now shows a link to the Gundam Fandom Wiki.
- **Direct link:** Shown when `model.wikiTitle` is stored — `https://gundam.fandom.com/wiki/{wikiTitle}`
- **Search fallback:** Shown for all other kits — `https://gundam.fandom.com/wiki/Special:Search?query={name}` — so every kit gets a usable link immediately
- **Where `wikiTitle` is saved:** In `fetch-image` handlers (both inventory and wishlist), the wiki page title returned from the Fandom search API is saved to the model as `wikiTitle` before any image download occurs
- **Thumbnail preservation:** `fetch-image` checks whether the existing thumbnail is a custom upload (filename does not contain `-auto.`). If so, it saves `wikiTitle` but skips the image download — the uploaded box photo is never overwritten.

---

## End-to-End Architecture

```
Browser
  │
  ├── GET /          → public/index.html  (collection page)
  ├── GET /wishlist  → public/wishlist.html
  ├── GET /kits      → AI-readable plain HTML inventory listing
  │
  ├── static assets served from public/
  │     app.js, wishlist.js, style.css
  │
  └── API calls → Express (server.js, port 3000)
                    │
                    ├── JSON data: data/inventory.json, data/wishlist.json
                    ├── Uploads:   public/uploads/thumbnails/, public/uploads/builds/
                    ├── Claude API (Anthropic SDK) → scan-box, scan-wishlist
                    └── Gundam Fandom Wiki API (HTTPS) → fetch-image endpoints
```

**Production stack (BitwerksWeb2):**
- nginx at `gundam.tomcannon.com` → reverse proxies to `localhost:3000`
- PM2 manages the Node process (`pm2 restart gundambase`)
- nginx basic auth on all non-GET routes (configured in `/etc/nginx/sites-enabled/gundam.conf`)
- `ANTHROPIC_API_KEY` stored in `ecosystem.config.js` (gitignored, `chmod 600`) for PM2 env injection

---

## Key Code Patterns

### server.js structure
```
requires → constants → mkdir guards → middleware → multer → 
readInventory/writeInventory → readWishlist/writeWishlist →
wikiGet() → downloadFile() → toSearchQuery() →   [module-level helpers, extracted for reuse across inventory + wishlist fetch-image routes]
routes (inventory CRUD, wishlist CRUD, scan endpoints) → app.listen
```

### Multer middleware reuse
The single `upload` multer instance serves both inventory and wishlist uploads. The `destination` callback reads `req.params.type` (`'thumbnail'` → `thumbnails/`, else `builds/`). Wishlist uses route `/api/wishlist/:id/upload/:type` with type always `thumbnail`.

### Grade badge classes
Cards and modals use `grade-badge badge-${grade}` (e.g. `badge-MG`) for the styled gradient badges in the collection view. Wishlist cards use inline `style` with `GRADE_COLORS` values instead, plus `.wish-grade-badge` positioning class.

### Priority system (wishlist only)
- Values: `high` | `medium` | `low`
- Card: small glowing `.priority-pip` dot (top-left of thumbnail) + `.priority-badge` text chip in card body
- Colors defined in CSS: `.priority-high` (red), `.priority-medium` (gold), `.priority-low` (blue/accent)

### Status vs Priority
- Inventory items have `status`: `backlog` | `in-progress` | `complete`
- Wishlist items have `priority`: `high` | `medium` | `low`
- These are entirely separate concepts on separate data stores

---

## Complete API Endpoint Reference

### Inventory
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/inventory` | No | List all kits |
| POST | `/api/inventory` | Yes (nginx) | Add kit |
| PATCH | `/api/inventory/:id` | Yes | Update fields: `status, notes, name, series, modelNumber, grade` |
| DELETE | `/api/inventory/:id` | Yes | Delete kit + files |
| POST | `/api/inventory/:id/upload/:type` | Yes | Upload thumbnail or build photo |
| POST | `/api/inventory/:id/fetch-image` | No | Wiki thumbnail fetch (saves wikiTitle, skips download if custom thumb) |
| POST | `/api/scan-box` | No | Claude Vision scan → `{name, grade, series, modelNumber}` |

### Wishlist
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/wishlist` | No | List all wishlist items |
| POST | `/api/wishlist` | Yes | Add item |
| PATCH | `/api/wishlist/:id` | Yes | Update fields: `priority, notes, name, series, modelNumber, grade, source` |
| DELETE | `/api/wishlist/:id` | Yes | Remove item + thumbnail file |
| POST | `/api/wishlist/:id/upload/:type` | Yes | Upload thumbnail |
| POST | `/api/wishlist/:id/fetch-image` | No | Wiki thumbnail fetch (same preservation logic as inventory) |
| POST | `/api/scan-wishlist` | No | Claude Vision scan → `{name, grade, series, modelNumber, source}` |

### Pages
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Collection page (index.html via static) |
| GET | `/wishlist` | Wishlist page (explicit route, not static) |
| GET | `/kits` | AI-readable plain HTML inventory |

---

## Data File Locations

| File | Purpose | Git-tracked |
|------|---------|-------------|
| `data/inventory.json` | All kit records | Yes |
| `data/wishlist.json` | Wishlist items | Yes |
| `public/uploads/thumbnails/` | Kit + wishlist thumbnails | No (gitignored) |
| `public/uploads/builds/` | Build progress photos | No (gitignored) |
| `ecosystem.config.js` | PM2 env (ANTHROPIC_API_KEY) | No (gitignored) |

---

## Known Constraints

- **Expo SDK 54 (mobile app):** Do NOT use `react-native-svg` or `expo-av`. Charts use pure RN flex layouts. Audio uses `expo-audio`.
- **nginx `client_max_body_size 25M`:** Required for iPhone photo uploads. Do not reduce.
- **HEIC conversion:** Done server-side with `heic-convert` (pure JS). The server's libheif lacks HEVC codec so system-level conversion is unavailable.
- **Auth on write routes:** nginx basic auth protects POST/PATCH/DELETE. The mobile app injects credentials via AsyncStorage (`auth_credentials` key, base64). Any new write routes are automatically protected by nginx without code changes.
- **`wikiTitle` population:** Existing kits that predate the wiki link feature won't have `wikiTitle` stored. The modal falls back to a wiki search URL for them. Clicking "Auto-fetch from wiki" on any kit will resolve and store the title (without overwriting a custom thumbnail).
