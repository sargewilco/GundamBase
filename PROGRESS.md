# KitKeeper — Agent Memory & Directive

> Read this before touching any code. Then read `CLAUDE.md` for project structure.
> This file is the source of truth for project state, conventions, and pending work.

---

## Active Branch: `wishlist`

All work lives on `wishlist`. Not yet merged to `master`.

**Deploy:**
```bash
# Local → GitHub
git push origin wishlist

# Server (BitwerksWeb2)
git fetch origin && git checkout wishlist && pm2 restart gundambase
```

**Server:** `gundam.tomcannon.com` · nginx → localhost:3000 · PM2 manages Node process
**Auth:** nginx basic auth on all POST/PATCH/DELETE routes automatically — no code changes needed for new write routes
**API key:** `ANTHROPIC_API_KEY` in `ecosystem.config.js` (gitignored, chmod 600) injected by PM2

---

## What Has Been Built

### Core App (pre-session, on master)
- Express + vanilla JS inventory manager, no build step
- Kit data in `data/inventory.json`, uploads in `public/uploads/` (both gitignored on server, tracked in git locally)
- Multer handles photo uploads → sharp converts to JPEG → stored in `public/uploads/thumbnails/` or `builds/`
- Gundam Fandom Wiki API used to auto-fetch thumbnails and store `wikiTitle` on kits

### Session Work (all on `wishlist` branch)

**Claude Vision Scanner** (`08bfeb3`)
- Replaced Ollama/moondream with `claude-haiku-4-5` via `@anthropic-ai/sdk`
- Uses `tool_use` with `tool_choice: { type: 'tool', name: '...' }` — NOT `output_config.format`. Structured outputs + vision had a silent bug where the image was dropped.
- Endpoint: `POST /api/scan-box` → `{ name, grade, series, modelNumber }`
- HEIC → JPEG via `heic-convert` (pure JS) before sharp, because server libheif lacks HEVC codec

**Scan Console Animation** (`807a801`)
- Terminal-style green monospace overlay during scan
- `startScanConsole()` / `stopScanConsole()` in `app.js`; `window._scanInterval` pattern
- CSS: `.scan-console`, `@keyframes scanLineFade`, `@keyframes scanBlink` in `style.css`

**Wishlist Feature** (`893c350`, `e515446`)
- Separate page at `/wishlist` (Express route serves `wishlist.html`, not static)
- Data: `data/wishlist.json` — items have `{ id, grade, name, series, modelNumber, source, priority, thumbnail, wikiTitle, notes, addedAt }`
- Priority: `high` | `medium` | `low` with colored badge + glowing pip on card thumbnail
- `POST /api/scan-wishlist` — same as scan-box but also extracts `source` (retailer)
- Promote flow: DELETE wishlist item → `sessionStorage.setItem('promoteKit', JSON.stringify({...}))` → `window.location = '/'` → `app.js` init reads sessionStorage and pre-fills Add modal
- Navigation: `♡ Wishlist` labeled button in desktop header (`.wishlist-nav-btn`); 4-tab mobile nav on collection page (Collection | + | Wishlist | Stats); 3-tab on wishlist page

**Wiki Links** (`a36b0dd`, `d8aeed9`)
- All kit modals show `↗ View on Gundam Wiki` (direct) or `↗ Search Gundam Wiki` (search fallback)
- `wikiTitle` saved to model during `fetch-image`. If kit has a custom (non-auto) thumbnail, `fetch-image` saves `wikiTitle` only and skips image download — uploaded box photos are never overwritten
- Detection: `thumbnail.includes('-auto.')` → auto-fetched; absence of `-auto.` → user upload

**Visual Quick Wins** (`cf76feb`)
- Backlog status badge hidden — only In Progress and Complete shown on cards
- Grade-colored hover glow: `data-grade` attribute on `.model-card` → CSS `[data-grade="PG"]:hover` etc.
- Grade section header accents: `data-grade` on `<section>` → colored left border + gradient fade

**Hero Banner** (`ae19beb`)
- Full-width featured card above grade sections for any `status === 'in-progress'` kit
- Grade-tinted background, pulsing green dot, large image, "View Details →" opens modal
- Filter-aware: hides when active filters exclude the in-progress kit
- `renderHero()` called at top of `renderGrades()`; targets `#hero-section` div in HTML

**SVG Favicon** (`78a7fea`)
- `public/favicon.svg` — dark navy background, blue outlined hexagon (pointy-top, matches ⬡ logo)
- Linked in both `index.html` and `wishlist.html`

---

## Pending Work

### Sort Options (medium effort)
Add a sort dropdown to the collection controls. Suggested options:
- Default (grade order, then insertion)
- A→Z name
- Series
- Date added (newest first)

Implementation: add `let sortMode = 'default'` state variable; modify `getFiltered()` or add a sort step inside `renderGrades()`; add a `<select>` to `.controls` in `index.html`.

### Stats Progress Bar (medium effort)
Visual "X of N built" bar. Suggested placement: slim bar just above the grade sections, or replace the plain number stats in the header with a bar. Use the existing `--green` color and `progress-track`/`progress-fill` CSS classes already in `style.css`.

### Scale Field (requires data model change — discuss before implementing)
Adding 1/60, 1/100, 1/144 etc. per kit. Needs:
- New `scale` field on inventory items (nullable string)
- Add/Edit modal UI update
- PATCH endpoint already allows new fields via the `allowed` array — just add `'scale'`
- Existing records won't have it; handle gracefully with `|| ''`
- **Do not implement without confirming the field name and display format with the user**

---

## Architecture at a Glance

```
public/index.html      → collection page shell
public/wishlist.html   → wishlist page shell
public/app.js          → all collection page logic (~650 lines)
public/wishlist.js     → all wishlist page logic (~280 lines)
public/style.css       → all styles, single file (~800 lines)
server.js              → all Express routes (~530 lines)
data/inventory.json    → kit records
data/wishlist.json     → wishlist records
```

**server.js structure (top to bottom):**
requires → constants (INVENTORY_PATH, WISHLIST_PATH, UPLOADS_DIR) → mkdir guards → middleware → multer → read/write helpers → module-level wiki helpers (wikiGet, downloadFile, toSearchQuery) → routes → app.listen

**Key API routes:**
- `GET/POST /api/inventory`, `PATCH/DELETE /api/inventory/:id`
- `POST /api/inventory/:id/upload/:type` — type = `thumbnail` or `build`
- `POST /api/inventory/:id/fetch-image` — wiki thumbnail (preserves custom uploads)
- `POST /api/scan-box` — Claude Vision → kit fields
- `GET/POST /api/wishlist`, `PATCH/DELETE /api/wishlist/:id`
- `POST /api/wishlist/:id/fetch-image`
- `POST /api/scan-wishlist` — Claude Vision → kit fields + source

---

## Conventions to Follow

**Grade colors** (used in JS and CSS, keep in sync):
```
PG #f0b429  MG #4f8ef7  RG #3ecf8e  FM #7c5ff7  HG #f97316  EG #ec4899  OTHER #4a5568
```

**Grade-specific CSS** — use `[data-grade="XX"]` attribute selectors, not extra classes. Cards and sections both carry `data-grade`.

**Claude scanning** — always use `tool_use` with `tool_choice: { type: 'tool', name: 'X' }`. Never use `output_config.format` with vision — the image gets silently dropped.

**Thumbnail lifecycle:**
- User upload: filename pattern `{id}-{timestamp}.jpg` → never auto-delete
- Wiki auto-fetch: filename pattern `{id}-auto.{ext}` → safe to replace on re-fetch
- Check `thumbnail.includes('-auto.')` to distinguish

**Multer reuse** — single `upload` instance serves both inventory and wishlist. Destination determined by `req.params.type` (`'thumbnail'` → thumbnails dir, else builds dir).

**Mobile nav** — `.mobile-nav { display: none }` by default; shown only in `@media (max-width: 700px)`. All `icon-btn` elements hidden on mobile too.

**No build step** — vanilla JS, direct file edits, no transpilation. Keep it that way.

**Commit style** — descriptive subject line, bullet body explaining what and why. Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
