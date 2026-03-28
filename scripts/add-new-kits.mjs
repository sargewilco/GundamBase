/**
 * add-new-kits.mjs
 * Scans all box photos, skips ones already matched to inventory,
 * and for unmatched photos extracts full kit details from the box
 * to create new inventory entries.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PHOTO_DIR = 'C:/Users/commw/OneDrive/Pictures/GundamBacklog';
const THUMB_DIR = path.join(ROOT, 'public/uploads/thumbnails');
const INVENTORY_PATH = path.join(ROOT, 'data/inventory.json');

const client = new Anthropic();
const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));

// Set of thumbnail filenames already saved
const existingBoxPhotos = new Set(
  fs.readdirSync(THUMB_DIR).filter(f => f.endsWith('-box.jpg'))
);

// Set of IDs already matched
const matchedIds = new Set(
  inventory
    .filter(k => k.thumbnail && k.thumbnail.includes('-box.jpg'))
    .map(k => k.id)
);

// Next available ID per grade
function nextId(grade) {
  const prefix = grade.toLowerCase();
  const existing = inventory
    .filter(k => k.grade === grade)
    .map(k => parseInt(k.id.split('-')[1]))
    .filter(n => !isNaN(n));
  const max = existing.length ? Math.max(...existing) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const kitList = inventory.map(k =>
  `ID: ${k.id} | Grade: ${k.grade} | Name: ${k.name} | Series: ${k.series}${k.modelNumber ? ' | Model#: ' + k.modelNumber : ''}`
).join('\n');

const photos = fs.readdirSync(PHOTO_DIR).filter(f => /\.heic$/i.test(f)).sort();
console.log(`Found ${photos.length} photos. Already matched: ${matchedIds.size}. Scanning for new kits...\n`);

async function convertAndResize(heicPath) {
  const inputBuffer = fs.readFileSync(heicPath);
  const jpegBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
  return sharp(Buffer.from(jpegBuffer))
    .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function identifyAndExtract(jpegBuffer) {
  const base64 = jpegBuffer.toString('base64');
  const resp = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        {
          type: 'text',
          text: `This is a photo of a Gundam/Gunpla model kit box.

Here are the kits already in my inventory:
${kitList}

First check if this kit is already in the inventory list above. If it matches an existing entry, return that ID.
If it is NOT in the inventory, extract the full kit details from the box art and text.

Valid grades: PG, MG, RG, HG, EG, FM, OTHER

Respond with ONLY a JSON object (no markdown):
{
  "matched_existing_id": "<existing ID if it matches, otherwise null>",
  "grade": "<PG|MG|RG|HG|EG|FM|OTHER>",
  "name": "<full kit name as shown on box>",
  "series": "<Gundam series name>",
  "modelNumber": "<model number e.g. RX-78-2, or null if not shown>",
  "confidence": "high|medium|low"
}`
        }
      ]
    }]
  });

  const text = resp.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Unparseable response: ${text}`);
  }
}

const newEntries = [];
let skipped = 0;

for (const filename of photos) {
  const photoPath = path.join(PHOTO_DIR, filename);
  process.stdout.write(`[${photos.indexOf(filename) + 1}/${photos.length}] ${filename} → `);

  try {
    const jpegBuffer = await convertAndResize(photoPath);
    const result = await identifyAndExtract(jpegBuffer);

    if (result.matched_existing_id && matchedIds.has(result.matched_existing_id)) {
      console.log(`skip (already matched to ${result.matched_existing_id})`);
      skipped++;
      continue;
    }

    if (result.matched_existing_id && inventory.find(k => k.id === result.matched_existing_id)) {
      // Matched an existing entry that didn't have a box photo yet
      const entry = inventory.find(k => k.id === result.matched_existing_id);
      const destFile = `${entry.id}-box.jpg`;
      fs.writeFileSync(path.join(THUMB_DIR, destFile), jpegBuffer);
      entry.thumbnail = `/uploads/thumbnails/${destFile}`;
      matchedIds.add(entry.id);
      console.log(`✓ late match → ${entry.id} (${result.confidence}) — ${result.name}`);
      continue;
    }

    // New kit
    const newId = nextId(result.grade);
    const destFile = `${newId}-box.jpg`;
    fs.writeFileSync(path.join(THUMB_DIR, destFile), jpegBuffer);

    const newEntry = {
      id: newId,
      grade: result.grade,
      name: result.name,
      series: result.series,
      modelNumber: result.modelNumber || null,
      thumbnail: `/uploads/thumbnails/${destFile}`,
      status: 'backlog',
      buildPhotos: [],
      notes: ''
    };

    inventory.push(newEntry);
    // Reserve this ID for subsequent photos in same grade
    matchedIds.add(newId);
    newEntries.push({ photo: filename, ...newEntry });
    console.log(`+ NEW ${newId} (${result.confidence}) — ${result.grade} ${result.name}`);

  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}

fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2));

console.log('\n── Summary ──');
console.log(`Skipped (already matched): ${skipped}`);
console.log(`New entries added: ${newEntries.length}`);
if (newEntries.length) {
  console.log('\nNew kits:');
  newEntries.forEach(e => console.log(`  ${e.id} — ${e.grade} ${e.name} (${e.series}) [${e.photo}]`));
}
console.log('\nDone. inventory.json updated.');
