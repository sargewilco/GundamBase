# tomcannon.com — Architecture Handoff

> Handoff doc for an AI/dev picking up work on this server. Describes how the site
> is hosted, deployed, and wired together. Scoped to what is verifiably documented —
> sections marked **(TODO: confirm)** need Tom to fill in details I don't have.

---

## TL;DR

`tomcannon.com` is hosted on a single Linux box (**BitwerksWeb2**) running **nginx**
as a reverse proxy in front of one or more **Node.js** apps managed by **PM2**.
Each app lives under its own subdomain. The one fully documented here is
**`gundam.tomcannon.com`** (the GundamBase / "KitKeeper" Gunpla inventory app).

```
Browser
  │  HTTPS
  ▼
nginx  (reverse proxy, TLS termination, basic auth on writes)
  │  proxy_pass → localhost:<port>
  ▼
Node.js app(s)  (managed by PM2)
  ▼
JSON file storage on disk  (no database)
```

---

## Server

| Thing | Value |
|-------|-------|
| Host | **BitwerksWeb2** (Linux) |
| Web server / proxy | **nginx** |
| Process manager | **PM2** |
| TLS | Terminated at nginx (presumed Let's Encrypt — **TODO: confirm**) |
| Apps | Node.js, no build step |

### nginx

- Site configs live in `/etc/nginx/sites-enabled/`.
- GundamBase config: `/etc/nginx/sites-enabled/gundam.conf`.
- Each subdomain gets a server block that `proxy_pass`es to a local Node port.
- `client_max_body_size 25M` is set on the gundam vhost to allow iPhone photo uploads.
- **Basic auth** protects all mutating routes (`POST`/`PATCH`/`DELETE`) at the nginx
  layer — the Node apps themselves do not implement auth. Any new write route is
  automatically protected; no app code change is needed for auth.
- GET routes are public.

### PM2

- Each app runs as a named PM2 process (e.g. `gundambase`).
- Restart an app: `pm2 restart <name>` (e.g. `pm2 restart gundambase`).
- Environment / secrets are injected via each app's `ecosystem.config.js`
  (gitignored, `chmod 600`). For GundamBase this provides `ANTHROPIC_API_KEY`.
- `pm2 list` to see running apps and their ports.

---

## Apps on this server

### gundam.tomcannon.com — GundamBase / KitKeeper  ✅ documented

Gunpla (Gundam model kit) inventory manager.

| Aspect | Detail |
|--------|--------|
| Repo | `GundamBase` (this repo) |
| Stack | Node.js + Express, vanilla JS frontend, **no build step** |
| Entry | `server.js` (single file, all routes) |
| Local port | `3000` |
| PM2 name | `gundambase` |
| Frontend | `public/` — `index.html`, `wishlist.html`, `app.js`, `wishlist.js`, `style.css` |
| Data store | `data/inventory.json`, `data/wishlist.json` — **flat JSON files, no DB** |
| Uploads | `public/uploads/{thumbnails,builds}/` |
| External APIs | Anthropic (Claude Vision box scanning), Gundam Fandom Wiki (thumbnails) |

**Key dependencies:** `express`, `multer` (uploads), `sharp` (image conversion),
`heic-convert` (iPhone HEIC → JPEG), `@anthropic-ai/sdk` (Claude Vision).

**Data persistence model:** there is no database. State is read/written as JSON
files on every request via `readInventory()/writeInventory()` (and wishlist
equivalents). Important consequences:
- `data/*.json` and `public/uploads/` are **gitignored** — they exist only on the
  server and are **not backed up by git**. This data is irreplaceable. (Worth adding
  a backup/export — currently none.)
- Concurrent writes are not transactional (single-user app, so low risk).

**Auth:** none in app code. nginx basic auth gates writes (see nginx section).

**Routes (all in `server.js`):**
- `GET /api/inventory`, `POST /api/inventory`, `PATCH /api/inventory/:id`, `DELETE /api/inventory/:id`
- `POST /api/inventory/:id/upload/:type` — `type` = `thumbnail` | `build`
- `POST /api/inventory/:id/fetch-image` — pulls thumbnail from Gundam Wiki
- `POST /api/scan-box` — Claude Vision extracts kit fields from a box photo
- `GET/POST /api/wishlist`, `PATCH/DELETE /api/wishlist/:id`, `POST /api/wishlist/:id/upload/:type`, `POST /api/wishlist/:id/fetch-image`
- `POST /api/scan-wishlist` — Claude Vision extracts kit fields + retailer
- `GET /wishlist` — serves `wishlist.html`
- `GET /kits` — plain HTML inventory dump (AI/human readable, public)

**Companion mobile app:** `GundamBaseApp` (separate repo) — React Native / Expo
SDK 54. Talks to `https://gundam.tomcannon.com/api`. Basic-auth credentials stored
in AsyncStorage. Not hosted on this server.

### Other subdomains / apps  — (TODO: confirm)

I have no documented information about other apps on `tomcannon.com` (e.g. the apex
domain itself, `www`, or other subdomains). If they exist, fill in per the template:

| Subdomain | App / repo | Stack | Local port | PM2 name | Notes |
|-----------|-----------|-------|-----------|----------|-------|
| `tomcannon.com` (apex) | ? | ? | ? | ? | ? |
| `<sub>.tomcannon.com` | ? | ? | ? | ? | ? |

---

## Deploying a change (GundamBase)

```bash
# Local → GitHub
git push origin <branch>      # active work currently on `wishlist` branch

# On BitwerksWeb2
git fetch origin
git checkout <branch>          # e.g. wishlist
git pull                       # if already on the branch
pm2 restart gundambase
```

Notes:
- `npm install` on the server only when `package.json` deps changed.
- Because `public/uploads/` is gitignored, any thumbnails generated by local bulk
  scripts must be SCP'd to the server separately — they do not travel through git.
- No build step — deploy is just pull + restart.

---

## Conventions & gotchas

- **No build step anywhere** — vanilla JS, edit files directly, no transpilation.
- **Secrets** live in per-app `ecosystem.config.js` (gitignored, `chmod 600`),
  injected by PM2. Never commit keys.
- **Claude Vision scanning** must use `tool_use` with
  `tool_choice: { type: 'tool', name: '...' }`. Do **not** use `output_config.format`
  with vision — the image gets silently dropped.
- **iPhone HEIC uploads** are converted with `heic-convert` (pure JS) because the
  server's libheif lacks the HEVC codec; then `sharp` produces the final JPEG.
- **Thumbnail lifecycle:** auto-fetched wiki images use filename pattern
  `{id}-auto.{ext}` (safe to overwrite); user uploads use `{id}-{timestamp}.jpg`
  (never auto-deleted). Code distinguishes via `thumbnail.includes('-auto.')`.

---

## Open items / risks

- **No backups** of `data/*.json` or `public/uploads/` — git excludes them and there
  is no documented backup job. Single point of data loss.
- **Other subdomains undocumented** (see TODO table above).
- **TLS provider/renewal** not documented — confirm certbot / Let's Encrypt setup.
- **No database** — fine at current scale; revisit if data grows or multi-user.

---

*Last generated from the GundamBase repo (`CLAUDE.md`, `PROGRESS.md`, `server.js`,
`package.json`). Verify server-side details (`pm2 list`, nginx configs) on the box
itself, and fill in the TODO sections.*
