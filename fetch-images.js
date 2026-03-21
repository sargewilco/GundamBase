/**
 * fetch-images.js
 * Bulk-fetches thumbnails from the Gundam Fandom Wiki for all models
 * that don't already have a thumbnail.
 *
 * Usage:
 *   node fetch-images.js           -- fetch missing only
 *   node fetch-images.js --all     -- re-fetch everything
 *   node fetch-images.js --id mg-001  -- fetch one model by id
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const INVENTORY_PATH = path.join(__dirname, 'data', 'inventory.json');
const THUMB_DIR = path.join(__dirname, 'public', 'uploads', 'thumbnails');
const WIKI_API = 'gundam.fandom.com';
const DELAY_MS = 400; // be polite to the wiki

const args = process.argv.slice(2);
const refetchAll = args.includes('--all');
const targetId = args.find((a, i) => args[i - 1] === '--id');

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

// ── Wiki search term extraction ──
// Takes the model name from inventory (grade already stripped) and cleans it
// into a good wiki search query for the mobile suit article.
function toWikiSearch(model) {
  let q = model.name
    .replace(/\bVer\.?\s*[\d.]+\b/gi, '')   // Ver. 3.0, Ver.3
    .replace(/\bVer\.?Ka\b/gi, '')           // Ver.Ka
    .replace(/\(OVA version\)/gi, '')
    .replace(/\(Luminous Crystal Body\)/gi, '')
    .replace(/\(\d+\/\d+\)/g, '')           // (1/100), (1/48)
    .replace(/\s+/g, ' ')
    .trim();

  // Prefer model number if it helps narrow things down
  // e.g. "RX-78-2 Gundam" is a great search term already
  return q;
}

// ── HTTP helpers ──
function get(hostname, path) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers: { 'User-Agent': 'GundamBase/1.0' } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse failed for ${path}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'GundamBase/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadImage(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Wiki fetch for one model ──
async function fetchWikiImage(model) {
  let title;

  if (model.wikiTitle) {
    // Use the explicit override directly
    title = model.wikiTitle;
  } else {
    const query = encodeURIComponent(toWikiSearch(model));
    // Step 1: search for the best matching article
    const searchData = await get(
      WIKI_API,
      `/api.php?action=query&list=search&srsearch=${query}&srnamespace=0&format=json&srlimit=5`
    );
    const results = searchData?.query?.search;
    if (!results?.length) return null;
    // Pick the best result: prefer exact model number match or first result
    title = results[0].title;
  }

  // Step 2: get the page's lead image
  const imgData = await get(
    WIKI_API,
    `/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&format=json&pithumbsize=600&redirects=1`
  );
  const pages = imgData?.query?.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  return page?.thumbnail?.source ?? null;
}

// ── Main ──
async function run() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const toProcess = inventory.filter(m => {
    if (targetId) return m.id === targetId;
    if (refetchAll) return true;
    return !m.thumbnail;
  });

  if (!toProcess.length) {
    console.log('Nothing to fetch. Use --all to re-fetch existing thumbnails.');
    return;
  }

  console.log(`Fetching images for ${toProcess.length} model(s)...\n`);
  let updated = 0;
  let failed = 0;

  for (const model of toProcess) {
    process.stdout.write(`  [${model.id}] ${model.grade} ${model.name} ... `);
    try {
      const imageUrl = await fetchWikiImage(model);
      if (!imageUrl) {
        console.log('not found on wiki');
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const ext = imageUrl.match(/\.(jpe?g|png|gif|webp)/i)?.[1] ?? 'jpg';
      const filename = `${model.id}-auto.${ext}`;
      const dest = path.join(THUMB_DIR, filename);
      await downloadImage(imageUrl, dest);

      // Update in-memory + inventory
      const idx = inventory.findIndex(m => m.id === model.id);
      inventory[idx].thumbnail = `/uploads/thumbnails/${filename}`;
      console.log('✓');
      updated++;
    } catch (err) {
      console.log(`error: ${err.message}`);
      failed++;
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2));
  console.log(`\nDone. ${updated} updated, ${failed} failed.`);
  if (failed) console.log('Tip: failed models can be manually assigned a thumbnail via the web UI.');
}

run().catch(console.error);
