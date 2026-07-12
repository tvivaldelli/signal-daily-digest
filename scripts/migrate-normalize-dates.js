#!/usr/bin/env node

/**
 * Data migration: normalize articles.pub_date to canonical UTC ISO-8601.
 *
 * Root cause (diagnosed 2026-07-11): rssFetcher stored raw RFC-822 pubDate
 * strings, and every pub_date comparison in db.js is a lexicographic TEXT
 * comparison — letter-prefixed rows always sort above ISO rows, freezing
 * the candidate pool. Companion code fix: server/dateUtils.js (Commit 2).
 * This script converts the existing rows using the SAME toUtcIso() the
 * ingest path now uses.
 *
 * Usage:
 *   node scripts/migrate-normalize-dates.js            # dry-run: report only, no writes
 *   node scripts/migrate-normalize-dates.js --execute  # migrate inside one transaction
 *
 * Tripwire discipline: both modes first enumerate exactly what would change
 * (row counts, zone-token distribution, 5 deterministic spot-checks). Execute
 * mode aborts before writing if any row is unparseable, verifies the update
 * count matches the enumeration, re-checks the spot-check rows, confirms zero
 * non-canonical rows remain, and runs PRAGMA integrity_check — any mismatch
 * rolls the transaction back.
 *
 * Take a fresh backup (articles.db + -wal + -shm as a set) before --execute.
 */

import { db } from '../server/db.js';
import { toUtcIso } from '../server/dateUtils.js';

const EXECUTE = process.argv.includes('--execute');

// Canonical form produced by Date.prototype.toISOString()
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Zone designators that pin the parse to an absolute time. Anything else
// (or a missing designator) makes new Date() fall back to SERVER-LOCAL time.
const EXPLICIT_ZONE = /^([+-]\d{4}|GMT|UT|UTC|Z|EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/;

function zoneToken(dateString) {
  const parts = dateString.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  return EXPLICIT_ZONE.test(last) ? last : `(no explicit zone: "${last}")`;
}

// --- 1. Enumerate current state (read-only) ---
const total = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
const rows = db.prepare('SELECT id, pub_date FROM articles ORDER BY id').all();

const canonical = [];
const toMigrate = [];
const unparseable = [];

for (const row of rows) {
  if (typeof row.pub_date === 'string' && CANONICAL_ISO.test(row.pub_date)) {
    canonical.push(row);
    continue;
  }
  const converted = toUtcIso(row.pub_date);
  if (converted === null) {
    unparseable.push(row);
  } else {
    toMigrate.push({ ...row, converted });
  }
}

console.log(`[Migration] Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN (no writes)'}`);
console.log(`[Migration] DB: ${db.name}`);
console.log(`[Migration] Total article rows:        ${total}`);
console.log(`[Migration] Already canonical ISO UTC: ${canonical.length}`);
console.log(`[Migration] Will convert:              ${toMigrate.length}`);
console.log(`[Migration] Unparseable:               ${unparseable.length}`);

// --- 2. Zone-token distribution across rows to convert ---
const distribution = new Map();
for (const row of toMigrate) {
  const token = zoneToken(row.pub_date);
  distribution.set(token, (distribution.get(token) || 0) + 1);
}
console.log('\n[Migration] Zone-token distribution of rows to convert:');
for (const [token, count] of [...distribution.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${token.padEnd(28)} ${count}`);
}

if (unparseable.length > 0) {
  console.log('\n[Migration] Unparseable rows (left untouched in dry-run, ABORT in execute):');
  for (const row of unparseable.slice(0, 20)) {
    console.log(`  id=${row.id} pub_date=${JSON.stringify(row.pub_date)}`);
  }
}

// --- 3. Deterministic spot-checks ---
// (a) 5 rows spread across the convert set by index, plus
// (b) gate amendment 2026-07-12: the first row (lowest id) of every zone
//     token whose conversion SHIFTS wall-clock time. Zero-offset tokens are
//     pure reformatting; the shifted rows are where a conversion bug hides,
//     so they must appear in the dry-run report and execute verification.
const UTC_TOKENS = /^(\+0000|-0000|GMT|UT|UTC|Z)$/;
const n = toMigrate.length;
const spotIndexes = n === 0 ? [] :
  [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1])];
const indexChecks = spotIndexes.map(i => toMigrate[i]);

const seenShiftingTokens = new Set();
const shiftingChecks = [];
for (const row of toMigrate) {
  const token = zoneToken(row.pub_date);
  if (UTC_TOKENS.test(token) || seenShiftingTokens.has(token)) continue;
  seenShiftingTokens.add(token);
  shiftingChecks.push(row);
}

const spotChecks = [];
for (const row of [...indexChecks, ...shiftingChecks]) {
  if (!spotChecks.some(r => r.id === row.id)) spotChecks.push(row);
}

console.log('\n[Migration] Spot-check conversions (original -> converted):');
for (const row of spotChecks) {
  const token = zoneToken(row.pub_date);
  const shifts = !UTC_TOKENS.test(token);
  console.log(`  id=${row.id} zone=${token}${shifts ? ' [wall-clock shifts]' : ''}`);
  console.log(`    "${row.pub_date}"`);
  console.log(`    -> "${row.converted}"`);
}

if (!EXECUTE) {
  console.log('\n[Migration] Dry-run complete. No writes performed. Re-run with --execute to migrate.');
  db.close();
  process.exit(0);
}

// --- 4. Execute mode: tripwires, then migrate in one transaction ---
if (unparseable.length > 0) {
  console.error(`\n[Migration] ABORT: ${unparseable.length} unparseable row(s). Nothing written.`);
  db.close();
  process.exit(1);
}
if (toMigrate.length === 0) {
  console.log('\n[Migration] Nothing to convert. No writes performed.');
  db.close();
  process.exit(0);
}

console.log(`\n[Migration] Expected effect: UPDATE exactly ${toMigrate.length} row(s), 0 rows deleted/inserted.`);

const update = db.prepare('UPDATE articles SET pub_date = ? WHERE id = ?');

const runMigration = db.transaction(() => {
  let changed = 0;
  for (const row of toMigrate) {
    changed += update.run(row.converted, row.id).changes;
  }
  if (changed !== toMigrate.length) {
    throw new Error(`update count mismatch: expected ${toMigrate.length}, got ${changed}`);
  }
  return changed;
});

let changed;
try {
  changed = runMigration();
} catch (err) {
  console.error(`[Migration] ABORT (transaction rolled back): ${err.message}`);
  db.close();
  process.exit(1);
}
console.log(`[Migration] Updated ${changed} row(s) (matches expected).`);

// --- 5. Post-verification ---
const totalAfter = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
if (totalAfter !== total) {
  console.error(`[Migration] ERROR: total row count changed! Before: ${total}, After: ${totalAfter}. Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log(`[Migration] Total rows after: ${totalAfter} (match)`);

const spotAfter = db.prepare(
  `SELECT id, pub_date FROM articles WHERE id IN (${spotChecks.map(() => '?').join(',')}) ORDER BY id`
).all(...spotChecks.map(r => r.id));
for (const row of spotAfter) {
  const expected = spotChecks.find(r => r.id === row.id).converted;
  const ok = row.pub_date === expected;
  console.log(`  id=${row.id} now "${row.pub_date}" ${ok ? 'OK' : `MISMATCH (expected "${expected}")`}`);
  if (!ok) {
    console.error('[Migration] ERROR: spot-check mismatch after commit. Restore from backup.');
    db.close();
    process.exit(1);
  }
}

const remaining = db.prepare('SELECT id, pub_date FROM articles ORDER BY id').all()
  .filter(r => !(typeof r.pub_date === 'string' && CANONICAL_ISO.test(r.pub_date)));
if (remaining.length > 0) {
  console.error(`[Migration] ERROR: ${remaining.length} non-canonical row(s) remain. Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log('[Migration] Non-canonical rows remaining: 0');

const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') {
  console.error(`[Migration] ERROR: integrity check failed: ${integrity.integrity_check}. Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log('[Migration] Integrity check: ok');
console.log('[Migration] Done.');

db.close();
