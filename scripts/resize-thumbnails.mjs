/**
 * resize-thumbnails.mjs
 *
 * One-time cleanup: shrinks oversized thumbnails in public/uploads/thumbnails/
 * down to a max of 1000px on the long edge and re-encodes them with mozjpeg.
 *
 * The bulk-imported box photos are ~1500px / ~240KB but render in ~200px cards,
 * so they're far larger than needed. This resizes them in place, which is the
 * main lever for first-load speed on the collection page.
 *
 * Matches the resize the upload route now applies, so new and old thumbnails
 * end up consistent.
 *
 * Usage (run where the real images live — the server):
 *   node scripts/resize-thumbnails.mjs            # dry run — reports savings
 *   node scripts/resize-thumbnails.mjs --write    # rewrites oversized files in place
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const THUMB_DIR = path.join(ROOT, 'public/uploads/thumbnails');

const WRITE = process.argv.includes('--write');
const MAX_EDGE = 1000;

const files = fs.readdirSync(THUMB_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));

let beforeTotal = 0, afterTotal = 0, resized = 0, skipped = 0;

for (const f of files) {
  const fp = path.join(THUMB_DIR, f);
  const beforeSize = fs.statSync(fp).size;
  const meta = await sharp(fp).metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);

  if (longEdge <= MAX_EDGE) {
    skipped++;
    continue;
  }

  // Re-encode to a buffer first so we never truncate the source on failure.
  const buf = await sharp(fp)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  beforeTotal += beforeSize;
  afterTotal += buf.length;
  resized++;

  const pct = (100 * (1 - buf.length / beforeSize)).toFixed(0);
  console.log(`  ${f.padEnd(22)} ${longEdge}px → ${MAX_EDGE}px   ${(beforeSize/1024).toFixed(0)}KB → ${(buf.length/1024).toFixed(0)}KB  (-${pct}%)`);

  if (WRITE) fs.writeFileSync(fp, buf);
}

console.log(`\nFiles: ${files.length}   oversized: ${resized}   already ok: ${skipped}`);
if (resized) {
  console.log(`Payload: ${(beforeTotal/1048576).toFixed(1)}MB → ${(afterTotal/1048576).toFixed(1)}MB  (-${(100*(1-afterTotal/beforeTotal)).toFixed(0)}%)`);
}
console.log(WRITE ? '\nDone — files rewritten.\n' : '\nDry run — nothing written. Re-run with --write to apply.\n');
