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
 * Files that DON'T carry a timestamp are skipped (left blank):
 *   - bulk-imported box photos:  `{id}-box.jpg`
 *   - wiki auto-fetched images:  `{id}-auto.{ext}`
 * These can't be reliably dated, so we don't guess.
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

// Match a 13-digit ms timestamp right before the file extension: `...-1774681657230.jpg`
const TS_RE = /-(\d{13})\.[a-z0-9]+$/i;

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));

const planned = [];   // { id, name, ts, iso }
const skipped = [];   // { id, reason }

for (const kit of inventory) {
  if (kit.addedAt) {
    skipped.push({ id: kit.id, reason: 'already has addedAt' });
    continue;
  }
  if (!kit.thumbnail) {
    skipped.push({ id: kit.id, reason: 'no thumbnail' });
    continue;
  }
  const file = path.basename(kit.thumbnail);
  const m = file.match(TS_RE);
  if (!m) {
    skipped.push({ id: kit.id, reason: `non-timestamped thumbnail (${file})` });
    continue;
  }
  const ts = Number(m[1]);
  const iso = new Date(ts).toISOString();
  planned.push({ id: kit.id, name: kit.name, ts, iso });
}

planned.sort((a, b) => a.ts - b.ts);

console.log(`\nInventory: ${inventory.length} kits`);
console.log(`Will set addedAt on: ${planned.length}`);
console.log(`Skipped: ${skipped.length}\n`);

if (planned.length) {
  console.log('Planned updates (oldest → newest):');
  for (const p of planned) {
    console.log(`  ${p.iso.slice(0, 10)}  ${p.id.padEnd(12)} ${p.name}`);
  }
}

// Summarize skip reasons so the dry run is easy to scan
const reasonCounts = skipped.reduce((acc, s) => {
  const key = s.reason.startsWith('non-timestamped') ? 'non-timestamped thumbnail' : s.reason;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
console.log('\nSkip reasons:', reasonCounts);

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
