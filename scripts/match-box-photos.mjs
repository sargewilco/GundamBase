/**
 * match-box-photos.mjs
 * Reads each HEIC box photo, uses Claude vision to identify the kit,
 * matches it to an inventory entry, converts to JPEG, saves as the
 * thumbnail, and updates inventory.json.
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

const kitList = inventory.map(k =>
  `ID: ${k.id} | Grade: ${k.grade} | Name: ${k.name} | Series: ${k.series}${k.modelNumber ? ' | Model#: ' + k.modelNumber : ''}`
).join('\n');

const photos = fs.readdirSync(PHOTO_DIR).filter(f => /\.heic$/i.test(f)).sort();
console.log(`Found ${photos.length} photos, ${inventory.length} inventory entries.\n`);

const results = [];
const unmatched = [];

async function identifyPhoto(jpegBuffer) {
  const base64 = jpegBuffer.toString('base64');
  const resp = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        {
          type: 'text',
          text: `This is a photo of a Gundam/Gunpla model kit box from my collection.
Look at the box art, text, grade markings, and model number to identify exactly which kit this is.

Here is my full inventory list:
${kitList}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "id": "<matched inventory ID or null>",
  "confidence": "high|medium|low",
  "identified_as": "<what you see on the box>",
  "reason": "<brief reason for match or why unmatched>"
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

async function convertHeic(heicPath) {
  const inputBuffer = fs.readFileSync(heicPath);
  const jpegBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
  // Resize to max 1500px on longest side — more than enough for Claude to read box text
  const resized = await sharp(Buffer.from(jpegBuffer))
    .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return resized;
}

for (const filename of photos) {
  const photoPath = path.join(PHOTO_DIR, filename);
  process.stdout.write(`[${photos.indexOf(filename) + 1}/${photos.length}] ${filename} → `);

  try {
    const jpegBuffer = await convertHeic(photoPath);
    const result = await identifyPhoto(jpegBuffer);

    if (result.id && inventory.find(k => k.id === result.id)) {
      const entry = inventory.find(k => k.id === result.id);
      const destFile = `${result.id}-box.jpg`;
      const destPath = path.join(THUMB_DIR, destFile);
      fs.writeFileSync(destPath, jpegBuffer);
      entry.thumbnail = `/uploads/thumbnails/${destFile}`;
      console.log(`✓ ${result.id} (${result.confidence}) — ${result.identified_as}`);
      results.push({ photo: filename, matchedId: result.id, confidence: result.confidence, dest: destFile });
    } else {
      console.log(`✗ unmatched — ${result.identified_as} | ${result.reason}`);
      unmatched.push({ photo: filename, identified_as: result.identified_as, reason: result.reason });
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    unmatched.push({ photo: filename, error: err.message });
  }
}

fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2));

console.log('\n── Summary ──');
console.log(`Matched: ${results.length} / ${photos.length}`);
if (unmatched.length) {
  console.log(`\nUnmatched (${unmatched.length}):`);
  unmatched.forEach(u => console.log(`  ${u.photo}: ${u.identified_as || u.error}`));
}
console.log('\nDone. inventory.json updated.');
