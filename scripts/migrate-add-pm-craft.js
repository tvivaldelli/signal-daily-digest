#!/usr/bin/env node

/**
 * One-time migration: drop CHECK constraint on featured_articles.section
 * to allow 'pm_craft' as a valid section value. Validation moves to app code
 * (markArticleFeatured in db.js).
 *
 * Usage: node scripts/migrate-add-pm-craft.js
 *
 * Steps:
 *   1. Copies the SQLite file to a timestamped backup
 *   2. Verifies the backup exists and matches the original size
 *   3. Snapshots 5 sample rows (ordered by URL) for post-migration comparison
 *   4. Recreates featured_articles without the CHECK constraint (in a transaction)
 *   5. Verifies row count matches before and after
 *   6. Deep-compares the 5 sample rows to confirm data integrity
 *   7. Runs PRAGMA integrity_check
 */

import { copyFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import assert from 'node:assert/strict';
import { db } from '../server/db.js';

const dbPath = db.name;
const dbDir = dirname(dbPath);

// --- 1. Backup ---
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(dbDir, `articles.backup-${timestamp}.db`);
console.log(`[Migration] Backing up ${dbPath}`);
console.log(`         -> ${backupPath}`);
copyFileSync(dbPath, backupPath);

const origSize = statSync(dbPath).size;
const backupSize = statSync(backupPath).size;
if (backupSize !== origSize) {
  console.error(`[Migration] ABORT: backup size (${backupSize}) != original (${origSize})`);
  process.exit(1);
}
console.log(`[Migration] Backup verified (${origSize} bytes)`);

// --- 2. Pre-migration state ---
const countBefore = db.prepare('SELECT COUNT(*) as n FROM featured_articles').get().n;
console.log(`[Migration] Rows before: ${countBefore}`);

// --- 3. Snapshot sample rows for post-migration comparison ---
const sampleBefore = db.prepare(
  'SELECT * FROM featured_articles ORDER BY url LIMIT 5'
).all();
console.log(`[Migration] Sampled ${sampleBefore.length} rows for comparison`);

// --- 4. Migrate (single transaction) ---
const migrationSQL = `
  BEGIN;

  CREATE TABLE featured_articles_new (
    url TEXT PRIMARY KEY,
    title TEXT,
    section TEXT NOT NULL,
    first_featured_date TEXT NOT NULL DEFAULT (datetime('now')),
    last_featured_date TEXT NOT NULL DEFAULT (datetime('now')),
    feature_count INTEGER NOT NULL DEFAULT 1
  );

  INSERT INTO featured_articles_new
    SELECT url, title, section, first_featured_date, last_featured_date, feature_count
    FROM featured_articles;

  DROP TABLE featured_articles;

  ALTER TABLE featured_articles_new RENAME TO featured_articles;

  CREATE INDEX IF NOT EXISTS idx_featured_section_date
    ON featured_articles(section, last_featured_date);

  COMMIT;
`;
db.pragma('foreign_keys = OFF');
for (const statement of migrationSQL.split(';').map(s => s.trim()).filter(Boolean)) {
  db.prepare(statement + ';').run();
}

// --- 5. Verify row count ---
const countAfter = db.prepare('SELECT COUNT(*) as n FROM featured_articles').get().n;
if (countAfter !== countBefore) {
  console.error(`[Migration] ERROR: row count mismatch! Before: ${countBefore}, After: ${countAfter}`);
  console.error(`[Migration] Restore from backup: cp "${backupPath}" "${dbPath}"`);
  process.exit(1);
}
console.log(`[Migration] Rows after: ${countAfter} (match)`);

// --- 6. Deep-compare sample rows ---
const sampleAfter = db.prepare(
  'SELECT * FROM featured_articles ORDER BY url LIMIT 5'
).all();

try {
  assert.deepStrictEqual(sampleAfter, sampleBefore);
  console.log(`[Migration] Sample row comparison: all ${sampleBefore.length} rows match`);
} catch (err) {
  console.error('[Migration] ERROR: sample rows do not match after migration!');
  console.error(err.message);
  console.error(`[Migration] Restore from backup: cp "${backupPath}" "${dbPath}"`);
  process.exit(1);
}

// --- 7. Integrity check ---
const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') {
  console.error(`[Migration] ERROR: integrity check failed: ${integrity.integrity_check}`);
  console.error(`[Migration] Restore from backup: cp "${backupPath}" "${dbPath}"`);
  process.exit(1);
}

console.log('[Migration] Integrity check: ok');
console.log(`[Migration] Done. Backup at: ${backupPath}`);

db.close();
