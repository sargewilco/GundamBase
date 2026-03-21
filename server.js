const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

const INVENTORY_PATH = path.join(__dirname, 'data', 'inventory.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure upload dirs exist
['thumbnails', 'builds'].forEach(dir => {
  const fullPath = path.join(UPLOADS_DIR, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer storage — destination determined by fieldname
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type === 'thumbnail' ? 'thumbnails' : 'builds';
    cb(null, path.join(UPLOADS_DIR, type));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
}

function writeInventory(data) {
  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(data, null, 2));
}

// GET all models
app.get('/api/inventory', (req, res) => {
  res.json(readInventory());
});

// PATCH model fields (status, notes)
app.patch('/api/inventory/:id', (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['status', 'notes', 'name', 'series'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) inventory[idx][key] = req.body[key];
  });
  writeInventory(inventory);
  res.json(inventory[idx]);
});

// POST upload thumbnail or build photo
app.post('/api/inventory/:id/upload/:type', upload.single('photo'), (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const filePath = `/uploads/${req.params.type === 'thumbnail' ? 'thumbnails' : 'builds'}/${req.file.filename}`;

  if (req.params.type === 'thumbnail') {
    // Remove old thumbnail file if it exists
    if (inventory[idx].thumbnail) {
      const oldPath = path.join(__dirname, 'public', inventory[idx].thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    inventory[idx].thumbnail = filePath;
  } else {
    inventory[idx].buildPhotos.push({ path: filePath, date: new Date().toISOString() });
  }

  writeInventory(inventory);
  res.json(inventory[idx]);
});

// POST auto-fetch thumbnail from Gundam Fandom Wiki
app.post('/api/inventory/:id/fetch-image', async (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const model = inventory[idx];

  function wikiGet(hostname, urlPath) {
    return new Promise((resolve, reject) => {
      const opts = { hostname, path: urlPath, method: 'GET', headers: { 'User-Agent': 'GundamBase/1.0' } };
      const request = https.request(opts, response => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse failed')); } });
      });
      request.on('error', reject);
      request.end();
    });
  }

  function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, { headers: { 'User-Agent': 'GundamBase/1.0' } }, response => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close(); fs.unlink(dest, () => {});
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
  }

  function toSearchQuery(m) {
    return m.name
      .replace(/\bVer\.?\s*[\d.]+\b/gi, '')
      .replace(/\bVer\.?Ka\b/gi, '')
      .replace(/\(OVA version\)/gi, '')
      .replace(/\(Luminous Crystal Body\)/gi, '')
      .replace(/\(\d+\/\d+\)/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  try {
    let title;
    if (model.wikiTitle) {
      title = encodeURIComponent(model.wikiTitle);
    } else {
      const q = encodeURIComponent(toSearchQuery(model));
      const searchData = await wikiGet('gundam.fandom.com',
        `/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&format=json&srlimit=5`);
      const results = searchData?.query?.search;
      if (!results?.length) return res.status(404).json({ error: 'Not found on wiki' });
      title = encodeURIComponent(results[0].title);
    }
    const imgData = await wikiGet('gundam.fandom.com',
      `/api.php?action=query&prop=pageimages&titles=${title}&format=json&pithumbsize=600&redirects=1`);
    const page = Object.values(imgData?.query?.pages ?? {})[0];
    const imageUrl = page?.thumbnail?.source;
    if (!imageUrl) return res.status(404).json({ error: 'No image on wiki page' });

    const ext = imageUrl.match(/\.(jpe?g|png|gif|webp)/i)?.[1] ?? 'jpg';
    const filename = `${model.id}-auto.${ext}`;
    const dest = path.join(UPLOADS_DIR, 'thumbnails', filename);

    // Remove old auto-fetched file if present
    if (inventory[idx].thumbnail?.includes('-auto.')) {
      const oldPath = path.join(__dirname, 'public', inventory[idx].thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await downloadFile(imageUrl, dest);
    inventory[idx].thumbnail = `/uploads/thumbnails/${filename}`;
    writeInventory(inventory);
    res.json(inventory[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a build photo
app.delete('/api/inventory/:id/build-photo', (req, res) => {
  const { photoPath } = req.body;
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  inventory[idx].buildPhotos = inventory[idx].buildPhotos.filter(p => p.path !== photoPath);
  writeInventory(inventory);

  const fullPath = path.join(__dirname, 'public', photoPath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  res.json(inventory[idx]);
});

app.listen(PORT, () => {
  console.log(`GundamBase running at http://localhost:${PORT}`);
});
