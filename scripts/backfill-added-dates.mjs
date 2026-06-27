/**
 * backfill-added-dates.mjs
 *
 * Recovers an approximate "added" date for kits by reading the upload
 * timestamp baked into app-uploaded thumbnail filenames.
 *
 * App uploads are named `{id}-{Date.now()}.jpg` (see server.js multer config),
 * so the 13-digit millisecond timestamp in the filename is a durable record of
 * when the photo was uploaded — unlike file mtimes, which reset on checkout/copy.
 *
 * Files that DON'T carry a timestamp get the EPOCH date below:
 *   - bulk-imported box photos:  `{id}-box.jpg`
 *   - wiki auto-fetched images:  `{id}-auto.{ext}`
 *   - kits with no thumbnail at all
 * These all came in with the initial collection upload, so we treat that
 * upload day as the collection's "epoch" rather than leaving them blank.
 *
 * Kits that already have an `addedAt` are never overwritten.
 *
 * Usage (run from the server, where the real data lives):
 *   node scripts/backfill-added-dates.mjs            # dry run — prints what it WOULD set
 *   node scripts/backfill-added-dates.mjs --write    # backs up JSON, then writes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INVENTORY_PATH = path.join(ROOT, 'data/inventory.json');

const WRITE = process.argv.includes('--write');

// The initial collection upload day. Kits without a recoverable upload
// timestamp are assigned this date. (Determined from the bulk box-photo mtimes.)
const EPOCH = '2026-03-28T00:00:00.000Z';

// Match a 13-digit ms timestamp right before the file extension: `...-1774681657230.jpg`
const TS_RE = /-(\d{13})\.[a-z0-9]+$/i;

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));

const recovered = [];  // { id, name, iso }  — real date from filename
const epoched = [];    // { id, name }       — assigned EPOCH
const skipped = [];    // { id }             — already had addedAt

for (const kit of inventory) {
  if (kit.addedAt) {
    skipped.push({ id: kit.id });
    continue;
  }
  const file = kit.thumbnail ? path.basename(kit.thumbnail) : '';
  const m = file.match(TS_RE);
  if (m) {
    recovered.push({ id: kit.id, name: kit.name, iso: new Date(Number(m[1])).toISOString() });
  } else {
    epoched.push({ id: kit.id, name: kit.name });
  }
}

recovered.sort((a, b) => a.iso.localeCompare(b.iso));

const planned = [
  ...recovered,
  ...epoched.map(e => ({ ...e, iso: EPOCH })),
];

console.log(`\nInventory: ${inventory.length} kits`);
console.log(`Recovered real dates from filenames: ${recovered.length}`);
console.log(`Assigned epoch (${EPOCH.slice(0, 10)}): ${epoched.length}`);
console.log(`Skipped (already had addedAt): ${skipped.length}\n`);

if (recovered.length) {
  console.log('Recovered dates (oldest → newest):');
  for (const p of recovered) {
    console.log(`  ${p.iso.slice(0, 10)}  ${p.id.padEnd(12)} ${p.name}`);
  }
  console.log('');
}

if (!WRITE) {
  console.log('\nDry run — nothing written. Re-run with --write to apply.\n');
  process.exit(0);
}

if (!planned.length) {
  console.log('\nNothing to write.\n');
  process.exit(0);
}

// Back up before writing
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${INVENTORY_PATH}.bak-${stamp}`;
fs.copyFileSync(INVENTORY_PATH, backupPath);
console.log(`\nBackup written: ${path.basename(backupPath)}`);

const byId = new Map(planned.map(p => [p.id, p.iso]));
for (const kit of inventory) {
  if (byId.has(kit.id)) kit.addedAt = byId.get(kit.id);
}

fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2));
console.log(`Wrote ${planned.length} addedAt values to data/inventory.json\n`);
