const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const heicConvert = require('heic-convert');

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

// GET public inventory page (AI-readable)
app.get('/kits', (req, res) => {
  const inventory = readInventory();
  const gradeOrder = ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'];
  const gradeLabels = { PG: 'Perfect Grade', MG: 'Master Grade', RG: 'Real Grade', FM: 'Full Mechanics', HG: 'High Grade', EG: 'Entry Grade', OTHER: 'Other' };
  const statusLabel = s => s === 'in-progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1);

  const sections = gradeOrder
    .filter(g => inventory.some(m => m.grade === g))
    .map(g => {
      const kits = inventory.filter(m => m.grade === g);
      const rows = kits.map(m => {
        const parts = [m.name, m.series];
        if (m.modelNumber) parts.push(m.modelNumber);
        parts.push(statusLabel(m.status));
        return `<li>${parts.join(' · ')}</li>`;
      }).join('\n');
      return `<h2>${g} — ${gradeLabels[g]} (${kits.length})</h2>\n<ul>\n${rows}\n</ul>`;
    }).join('\n\n');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GundamBase Inventory</title>
<style>
  body { font-family: sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  p.meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  h2 { font-size: 1rem; margin: 1.5rem 0 0.4rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 3px 0; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>GundamBase Inventory</h1>
<p class="meta">${inventory.length} kits total · Last updated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
${sections}
</body>
</html>`);
});

// POST add new model
app.post('/api/inventory', (req, res) => {
  const { grade, name, series, modelNumber, notes } = req.body;
  if (!grade || !name || !series) return res.status(400).json({ error: 'grade, name and series are required' });
  const inventory = readInventory();
  const id = `${grade.toLowerCase()}-${Date.now()}`;
  const model = { id, grade, name, series, modelNumber: modelNumber || null, thumbnail: null, status: 'backlog', buildPhotos: [], notes: notes || '' };
  inventory.push(model);
  writeInventory(inventory);
  res.status(201).json(model);
});

// PATCH model fields
app.patch('/api/inventory/:id', (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['status', 'notes', 'name', 'series', 'modelNumber', 'grade'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) inventory[idx][key] = req.body[key];
  });
  writeInventory(inventory);
  res.json(inventory[idx]);
});

// DELETE a model
app.delete('/api/inventory/:id', (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const model = inventory[idx];
  // Clean up thumbnail and build photos
  if (model.thumbnail) {
    const p = path.join(__dirname, 'public', model.thumbnail);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  model.buildPhotos.forEach(photo => {
    const p = path.join(__dirname, 'public', photo.path);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  inventory.splice(idx, 1);
  writeInventory(inventory);
  res.json({ ok: true });
});

// POST upload thumbnail or build photo
app.post('/api/inventory/:id/upload/:type', upload.single('photo'), async (req, res) => {
  try {
    const inventory = readInventory();
    const idx = inventory.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const isThumbnail = req.params.type === 'thumbnail';
    const subdir = isThumbnail ? 'thumbnails' : 'builds';
    const rawPath = req.file.path;

    // Convert to JPEG so HEIC and other formats display in all browsers
    const jpegFilename = req.file.filename.replace(/\.[^.]+$/, '.jpg');
    const jpegPath = path.join(UPLOADS_DIR, subdir, jpegFilename);
    await sharp(rawPath).jpeg({ quality: 88 }).toFile(jpegPath);
    if (rawPath !== jpegPath) fs.unlinkSync(rawPath);

    const filePath = `/uploads/${subdir}/${jpegFilename}`;

    if (isThumbnail) {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST auto-fetch thumbnail from Gundam Fandom Wiki
app.post('/api/inventory/:id/fetch-image', async (req, res) => {
  const inventory = readInventory();
  const idx = inventory.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const model = inventory[idx];

  function wikiGet(hostname, urlPath) {
    return new Promise((resolve, reject) => {
      const opts = { hostname, path: urlPath, method: 'GET', headers: { 'User-Agent': 'KitKeeper/1.0' } };
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
      https.get(url, { headers: { 'User-Agent': 'KitKeeper/1.0' } }, response => {
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

// POST scan a box photo with local moondream model via Ollama
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/scan-box', memUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const tmpPath = path.join(UPLOADS_DIR, `scan-tmp-${Date.now()}`);
  try {
    const isHeic = /heic|heif/i.test(req.file.mimetype) || /\.heic$/i.test(req.file.originalname);
    let sourceBuffer = req.file.buffer;
    if (isHeic) {
      sourceBuffer = Buffer.from(await heicConvert({ buffer: sourceBuffer, format: 'JPEG', quality: 0.85 }));
    }
    fs.writeFileSync(tmpPath, sourceBuffer);
    const jpegBuffer = await sharp(tmpPath).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    fs.unlinkSync(tmpPath);
    const b64 = jpegBuffer.toString('base64');

    const prompt =
      'This is a Gundam plastic model kit box. ' +
      'Extract kit details and respond ONLY with a JSON object — no markdown, no explanation. ' +
      'Fields: "name" (kit name), "grade" (exactly one of: PG MG RG FM HG EG OTHER), ' +
      '"series" (Gundam series name), "modelNumber" (model number or null). ' +
      'Example: {"name":"RX-78-2 Gundam","grade":"MG","series":"Mobile Suit Gundam","modelNumber":"RX-78-2"}';

    const body = JSON.stringify({ model: 'moondream', prompt, images: [b64], stream: false });

    const ollamaRes = await new Promise((resolve, reject) => {
      const req2 = http.request(
        { hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }
      );
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    const raw = JSON.parse(ollamaRes).response || '';
    // Extract JSON from the response (moondream sometimes wraps it in text)
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse kit data from image', raw });
    const kit = JSON.parse(match[0]);
    res.json(kit);
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
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
  console.log(`Kit Keeper running at http://localhost:${PORT}`);
});
