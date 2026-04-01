# GundamBase — Project Context

Gunpla (Gundam plastic model kit) inventory manager with a web app and companion React Native mobile app.

## Project Structure

| Path | Purpose |
|------|---------|
| `C:\Users\commw\GundamBase` | Web app (this repo) |
| `C:\Users\commw\GundamBaseApp` | React Native / Expo mobile app (separate repo) |

## Web App (`GundamBase`)

- **Stack**: Node.js + Express, vanilla JS frontend, no build step
- **Entry point**: `server.js`
- **Frontend**: `public/` — `index.html`, `style.css`, `app.js`
- **Data**: `data/inventory.json` (gitignored; contains all kit records)
- **Uploads**: `public/uploads/` (gitignored; kit thumbnails stored here)
- **Scripts**: `scripts/` — one-off scripts for bulk photo matching via Claude Vision API
- **Dev**: `npm run dev` (nodemon), `npm start` (production)

### API Endpoints
- `GET /api/inventory` — list all kits
- `POST /api/inventory` — add kit (requires auth)
- `PATCH /api/inventory/:id` — update kit (requires auth)
- `DELETE /api/inventory/:id` — delete kit (requires auth)
- `POST /api/inventory/:id/photo` — upload photo (requires auth)

### Deployment
- Server: **BitwerksWeb2** (Linux)
- Process manager: **PM2** (`pm2 restart gundambase`)
- Reverse proxy: **nginx** at `gundam.tomcannon.com`
- nginx requires **basic auth** for all non-GET routes
- Deploy: `git pull && pm2 restart gundambase` on server
- Uploads folder is gitignored — SCP thumbnails directly to server after bulk scripts

### nginx Config
- Config at `/etc/nginx/sites-enabled/gundam.conf`
- `client_max_body_size 25M` set to support iPhone photo uploads
- Basic auth protects POST/PATCH/DELETE routes

### Key Notes
- `data/inventory.json` and `public/uploads/` are gitignored — never in git
- HEIC uploads from iPhone are converted to JPEG via `sharp` on upload
- Box photo thumbnails named `{id}-box.jpg` in `public/uploads/`
- Bulk photo matching scripts use `@anthropic-ai/sdk` (devDependency) with Claude Vision

## Mobile App (`GundamBaseApp`)

- **Stack**: React Native, Expo SDK 54, React Navigation
- **Run**: `npx expo start` then press `i` for iOS simulator
- **Navigation**: Bottom tabs — Collection (stack) + Stats (stack)
- **Auth**: Basic auth credentials stored in AsyncStorage (`auth_credentials` key, base64)
- **API**: Connects to `https://gundam.tomcannon.com/api`

### Screens
| Screen | File |
|--------|------|
| Collection grid | `screens/CollectionScreen.js` |
| Kit detail | `screens/KitDetailScreen.js` |
| Add / Edit kit | `screens/AddEditScreen.js` |
| Stats | `screens/StatsScreen.js` |

### Key Files
- `services/api.js` — all API calls with auth header injection
- `constants/theme.js` — shared colors and grade color tokens
- `utils/feedback.js` — haptic + sound feedback helpers

### Known Compatibility Constraints (Expo SDK 54)
- **Do NOT use** `react-native-svg` — incompatible with SDK 54
- **Do NOT use** `expo-av` — deprecated in SDK 54; use `expo-audio` instead
- Charts/visualizations use pure React Native `View` flex layouts (no SVG library)

## Grades
`PG`, `MG`, `RG`, `FM`, `HG`, `EG`, `OTHER`

## Kit Status Values
`backlog`, `in-progress`, `complete`
