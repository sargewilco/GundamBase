const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

const app = express();
const PORT = 3000;

const INVENTORY_PATH = path.join(__dirname, 'data', 'inventory.json');
const WISHLIST_PATH = path.join(__dirname, 'data', 'wishlist.json');
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

function readWishlist() {
  if (!fs.existsSync(WISHLIST_PATH)) return [];
  return JSON.parse(fs.readFileSync(WISHLIST_PATH, 'utf8'));
}

function writeWishlist(data) {
  fs.writeFileSync(WISHLIST_PATH, JSON.stringify(data, null, 2));
}

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

// GET all models
app.get('/api/inventory', (req, res) => {
  res.json(readInventory());
});

// GET wishlist page
app.get('/wishlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wishlist.html'));
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
    inventory[idx].wikiTitle = decodeURIComponent(title);
    writeInventory(inventory);
    res.json(inventory[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST scan a box photo with Claude Vision
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/scan-box', memUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const tmpPath = path.join(UPLOADS_DIR, `scan-tmp-${Date.now()}`);
  try {
    console.log('[scan-box] received file:', req.file.originalname, req.file.mimetype, req.file.size, 'bytes');
    const isHeic = /heic|heif/i.test(req.file.mimetype) || /\.heic$/i.test(req.file.originalname);
    let sourceBuffer = req.file.buffer;
    if (isHeic) {
      console.log('[scan-box] converting HEIC to JPEG');
      sourceBuffer = Buffer.from(await heicConvert({ buffer: sourceBuffer, format: 'JPEG', quality: 0.85 }));
    }
    fs.writeFileSync(tmpPath, sourceBuffer);
    const jpegBuffer = await sharp(tmpPath).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    fs.unlinkSync(tmpPath);
    const b64 = jpegBuffer.toString('base64');
    console.log('[scan-box] image prepared, sending to Claude (%d bytes base64)', b64.length);

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{
        name: 'extract_kit_info',
        description: 'Extract Gundam model kit details visible on the box',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Kit name as printed on box (e.g. "Nu Gundam Ver.Ka")' },
            grade: { type: 'string', enum: ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'], description: 'Grade abbreviation shown on box' },
            series: { type: 'string', description: 'Gundam series name (e.g. "Char\'s Counterattack")' },
            modelNumber: { type: 'string', description: 'Model number from box (e.g. "RX-93"), empty string if not visible' }
          },
          required: ['name', 'grade', 'series', 'modelNumber']
        }
      }],
      tool_choice: { type: 'tool', name: 'extract_kit_info' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: 'Examine this Gundam model kit box carefully and extract the kit details from the text and markings visible on the box.' }
        ]
      }]
    });

    const toolBlock = message.content.find(b => b.type === 'tool_use');
    console.log('[scan-box] Claude response:', JSON.stringify(toolBlock.input));
    const kit = { ...toolBlock.input, modelNumber: toolBlock.input.modelNumber || null };
    res.json(kit);
  } catch (err) {
    console.error('[scan-box] error:', err.message);
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

// ── Wishlist Routes ──

app.get('/api/wishlist', (req, res) => {
  res.json(readWishlist());
});

app.post('/api/wishlist', (req, res) => {
  const { grade, name, series, modelNumber, source, priority, notes } = req.body;
  if (!grade || !name || !series) return res.status(400).json({ error: 'grade, name and series are required' });
  const wishlist = readWishlist();
  const id = `wish-${Date.now()}`;
  const item = {
    id, grade, name, series,
    modelNumber: modelNumber || null,
    source: source || '',
    priority: priority || 'medium',
    thumbnail: null,
    notes: notes || '',
    addedAt: new Date().toISOString()
  };
  wishlist.push(item);
  writeWishlist(wishlist);
  res.status(201).json(item);
});

app.patch('/api/wishlist/:id', (req, res) => {
  const wishlist = readWishlist();
  const idx = wishlist.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['priority', 'notes', 'name', 'series', 'modelNumber', 'grade', 'source'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) wishlist[idx][key] = req.body[key];
  });
  writeWishlist(wishlist);
  res.json(wishlist[idx]);
});

app.delete('/api/wishlist/:id', (req, res) => {
  const wishlist = readWishlist();
  const idx = wishlist.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = wishlist[idx];
  if (item.thumbnail) {
    const p = path.join(__dirname, 'public', item.thumbnail);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  wishlist.splice(idx, 1);
  writeWishlist(wishlist);
  res.json({ ok: true });
});

app.post('/api/wishlist/:id/upload/:type', upload.single('photo'), async (req, res) => {
  try {
    const wishlist = readWishlist();
    const idx = wishlist.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const rawPath = req.file.path;
    const jpegFilename = req.file.filename.replace(/\.[^.]+$/, '.jpg');
    const jpegPath = path.join(UPLOADS_DIR, 'thumbnails', jpegFilename);
    await sharp(rawPath).jpeg({ quality: 88 }).toFile(jpegPath);
    if (rawPath !== jpegPath) fs.unlinkSync(rawPath);

    const filePath = `/uploads/thumbnails/${jpegFilename}`;
    if (wishlist[idx].thumbnail) {
      const oldPath = path.join(__dirname, 'public', wishlist[idx].thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    wishlist[idx].thumbnail = filePath;
    writeWishlist(wishlist);
    res.json(wishlist[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wishlist/:id/fetch-image', async (req, res) => {
  const wishlist = readWishlist();
  const idx = wishlist.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const model = wishlist[idx];
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

    if (wishlist[idx].thumbnail?.includes('-auto.')) {
      const oldPath = path.join(__dirname, 'public', wishlist[idx].thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await downloadFile(imageUrl, dest);
    wishlist[idx].thumbnail = `/uploads/thumbnails/${filename}`;
    wishlist[idx].wikiTitle = decodeURIComponent(title);
    writeWishlist(wishlist);
    res.json(wishlist[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan-wishlist', memUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const tmpPath = path.join(UPLOADS_DIR, `scan-tmp-${Date.now()}`);
  try {
    const isHeic = /heic|heif/i.test(req.file.mimetype) || /\.heic$/i.test(req.file.originalname);
    let sourceBuffer = req.file.buffer;
    if (isHeic) {
      sourceBuffer = Buffer.from(await heicConvert({ buffer: sourceBuffer, format: 'JPEG', quality: 0.85 }));
    }
    fs.writeFileSync(tmpPath, sourceBuffer);
    const jpegBuffer = await sharp(tmpPath).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    fs.unlinkSync(tmpPath);
    const b64 = jpegBuffer.toString('base64');

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{
        name: 'extract_wishlist_item',
        description: 'Extract Gundam model kit details and retailer from image',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Kit name (e.g. "Nu Gundam Ver.Ka")' },
            grade: { type: 'string', enum: ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'], description: 'Grade abbreviation' },
            series: { type: 'string', description: 'Gundam series name' },
            modelNumber: { type: 'string', description: 'Model number (e.g. "RX-93"), empty string if not visible' },
            source: { type: 'string', description: 'Retailer or store name visible in image (e.g. "Amazon", "Gundam Planet", "HobbyLink Japan"), empty string if not visible' }
          },
          required: ['name', 'grade', 'series', 'modelNumber', 'source']
        }
      }],
      tool_choice: { type: 'tool', name: 'extract_wishlist_item' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: 'Examine this image. It may be a Gundam model kit box photo or a product listing screenshot. Extract the kit details and the store or retailer name if visible.' }
        ]
      }]
    });

    const toolBlock = message.content.find(b => b.type === 'tool_use');
    const kit = {
      ...toolBlock.input,
      modelNumber: toolBlock.input.modelNumber || null,
      source: toolBlock.input.source || ''
    };
    res.json(kit);
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Kit Keeper running at http://localhost:${PORT}`);
});
