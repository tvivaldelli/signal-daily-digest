#!/usr/bin/env node

/**
 * Schema migration: add a NOT NULL + CHECK constraint to articles.pub_date so
 * any non-canonical value is rejected at the DB boundary. A future unnormalized
 * writer then fails LOUDLY instead of silently re-freezing the candidate pool
 * (the 2026-07 date-corruption class). Companion to the code guard in
 * server/db.js, which puts the same constraint on freshly-created DBs.
 *
 * SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so this is the official
 * table-rebuild path (new table + CHECK, id-preserving copy, drop, rename,
 * recreate indexes, fix the AUTOINCREMENT counter) inside one transaction.
 *
 * Usage:
 *   node scripts/migrate-add-pubdate-check.js            # dry-run: report only, no writes
 *   node scripts/migrate-add-pubdate-check.js --execute  # rebuild inside one transaction
 *
 * Tripwire discipline (mirrors migrate-normalize-dates.js): both modes first
 * enumerate LIVE — total rows, NULL pub_date rows, and rows that fail the GLOB
 * shape. Execute mode ABORTS before writing if any NULL or any failing row
 * exists (nothing is written), verifies the copied row count equals the
 * pre-count, re-points sqlite_sequence, then post-verifies integrity_check,
 * foreign_key_check, unchanged count, the constraint's presence in the schema,
 * and a live SAVEPOINT rejection self-test. Any mismatch rolls back.
 *
 * Take a fresh backup (articles.db + -wal + -shm as a set, counts verified)
 * before --execute. This is a schema-changing prod write.
 */

import { db } from '../server/db.js';

const EXECUTE = process.argv.includes('--execute');

// The exact GLOB shape enforced by the new CHECK. Must stay byte-identical to
// the predicate in server/db.js and to the CANONICAL_ISO regex that the
// date-normalization migration verified on every row.
const CANONICAL_GLOB =
  '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';

// The 14 columns of articles, in definition order. Explicit list (not SELECT *)
// keeps the copy immune to column-order drift and preserves saved_at/created_at
// verbatim instead of firing their datetime('now') defaults.
const COLUMNS = [
  'id', 'link', 'title', 'source', 'category', 'type', 'summary',
  'original_content', 'image_url', 'content_html', 'has_full_content',
  'pub_date', 'saved_at', 'created_at',
];

// Identical to server/db.js's articles table except the pub_date line.
const NEW_TABLE_DDL = `
  CREATE TABLE articles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    source TEXT,
    category TEXT,
    type TEXT DEFAULT 'article',
    summary TEXT,
    original_content TEXT,
    image_url TEXT,
    content_html TEXT,
    has_full_content INTEGER DEFAULT 0,
    pub_date TEXT NOT NULL CHECK (pub_date GLOB '${CANONICAL_GLOB}'),
    saved_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

// The 4 indexes dropped with the old table, recreated verbatim from db.js.
const INDEX_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_source ON articles(source)',
  'CREATE INDEX IF NOT EXISTS idx_category ON articles(category)',
  'CREATE INDEX IF NOT EXISTS idx_pub_date ON articles(pub_date)',
  'CREATE INDEX IF NOT EXISTS idx_saved_at ON articles(saved_at)',
];

// --- 1. Enumerate current state (read-only) ---
const total = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
const maxId = db.prepare('SELECT MAX(id) AS m FROM articles').get().m; // null if empty

// Authoritative AUTOINCREMENT high-water. NOT MAX(id): AUTOINCREMENT never lets
// the stored counter go backward, so once the highest-id rows are deleted the
// true high-water exceeds MAX(id). Preserving this (not MAX(id)) is what keeps a
// future insert from reusing a deleted id — reader URLs are /read/:id.
const preSeqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'articles'").get();
const highWater = preSeqRow ? preSeqRow.seq : 0;

const nullRows = db
  .prepare('SELECT id, link, source FROM articles WHERE pub_date IS NULL ORDER BY id')
  .all();
const failingRows = db
  .prepare(
    'SELECT id, source, pub_date FROM articles WHERE pub_date IS NOT NULL AND pub_date NOT GLOB ? ORDER BY id'
  )
  .all(CANONICAL_GLOB);

const passing = total - nullRows.length - failingRows.length;

console.log(`[Migration] Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN (no writes)'}`);
console.log(`[Migration] DB: ${db.name}`);
console.log(`[Migration] Total article rows:                 ${total}`);
console.log(`[Migration] Pass CHECK (canonical ISO UTC):     ${passing}`);
console.log(`[Migration] NULL pub_date (violate NOT NULL):   ${nullRows.length}`);
console.log(`[Migration] Fail GLOB shape (non-canonical):    ${failingRows.length}`);
console.log(`[Migration] Max id present:                     ${maxId ?? '(empty table)'}`);
console.log(`[Migration] AUTOINCREMENT high-water (seq):      ${highWater}${highWater !== (maxId ?? 0) ? `  (exceeds max id ${maxId ?? 0} — drained rows)` : ''}`);

if (nullRows.length > 0) {
  console.log('\n[Migration] NULL pub_date rows (a saveArticle path bypassed the fallback — code bug):');
  for (const row of nullRows.slice(0, 20)) {
    console.log(`  id=${row.id} source=${JSON.stringify(row.source)} link=${JSON.stringify(row.link)}`);
  }
  if (nullRows.length > 20) console.log(`  ... and ${nullRows.length - 20} more`);
}

if (failingRows.length > 0) {
  console.log('\n[Migration] Non-canonical pub_date rows (would violate CHECK):');
  for (const row of failingRows.slice(0, 20)) {
    console.log(`  id=${row.id} source=${JSON.stringify(row.source)} pub_date=${JSON.stringify(row.pub_date)}`);
  }
  if (failingRows.length > 20) console.log(`  ... and ${failingRows.length - 20} more`);
}

if (!EXECUTE) {
  console.log('\n[Migration] New table definition that --execute would apply:');
  console.log(NEW_TABLE_DDL.trimEnd());
  console.log('\n[Migration] Rebuild steps (one transaction): create articles_new, copy 14 cols');
  console.log('            id-preserving, drop articles, rename, recreate 4 indexes, fix');
  console.log('            sqlite_sequence, then integrity_check + SAVEPOINT rejection test.');
  if (nullRows.length > 0 || failingRows.length > 0) {
    console.log(`\n[Migration] NOTE: ${nullRows.length} NULL + ${failingRows.length} non-canonical row(s) present — --execute would ABORT before writing.`);
  }
  console.log('\n[Migration] Dry-run complete. No writes performed. Re-run with --execute to migrate.');
  db.close();
  process.exit(0);
}

// --- 2. Execute mode: tripwires before any write ---
if (nullRows.length > 0 || failingRows.length > 0) {
  console.error(
    `\n[Migration] ABORT: ${nullRows.length} NULL + ${failingRows.length} non-canonical row(s) would violate the constraint. Nothing written.`
  );
  db.close();
  process.exit(1);
}

console.log(`\n[Migration] Expected effect: rebuild articles preserving all ${total} row(s), 0 deleted/inserted (id-preserving copy).`);

const copyColumns = COLUMNS.join(', ');
const runRebuild = db.transaction(() => {
  db.exec(NEW_TABLE_DDL);

  const inserted = db
    .prepare(`INSERT INTO articles_new (${copyColumns}) SELECT ${copyColumns} FROM articles`)
    .run().changes;
  if (inserted !== total) {
    throw new Error(`copy count mismatch: expected ${total}, copied ${inserted}`);
  }

  db.exec('DROP TABLE articles');
  db.exec('ALTER TABLE articles_new RENAME TO articles');
  for (const ddl of INDEX_DDL) db.exec(ddl);

  // Restore the AUTOINCREMENT high-water to its pre-rebuild value. The copy
  // leaves an 'articles_new' sqlite_sequence row at MAX(id) (or none, if 0 rows
  // copied), and RENAME's handling of that row's name varies by SQLite version.
  // Deleting both and re-inserting the captured highWater is deterministic and
  // keeps the counter from moving backward (id reuse → wrong /read/:id).
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('articles', 'articles_new')").run();
  if (highWater > 0) {
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('articles', ?)").run(highWater);
  }
  const seqAfter = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'articles'").get();
  const seqVal = seqAfter ? seqAfter.seq : 0;
  if (seqVal !== highWater) {
    throw new Error(`sqlite_sequence high-water mismatch: expected ${highWater}, got ${seqVal}`);
  }

  return inserted;
});

let copied;
try {
  copied = runRebuild();
} catch (err) {
  console.error(`[Migration] ABORT (transaction rolled back): ${err.message}`);
  db.close();
  process.exit(1);
}
console.log(`[Migration] Rebuilt articles: copied ${copied} row(s) (matches expected).`);

// --- 3. Post-verification (outside the transaction) ---
const totalAfter = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
if (totalAfter !== total) {
  console.error(`[Migration] ERROR: row count changed! Before: ${total}, After: ${totalAfter}. Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log(`[Migration] Total rows after: ${totalAfter} (match)`);

const seqReport = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'articles'").get();
console.log(`[Migration] AUTOINCREMENT high-water after: ${seqReport ? seqReport.seq : 0} (pre-rebuild: ${highWater})`);

const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'articles'").get().sql;
if (!schema.includes('CHECK (pub_date GLOB')) {
  console.error('[Migration] ERROR: rebuilt schema does not contain the CHECK constraint. Restore from backup.');
  db.close();
  process.exit(1);
}
console.log('[Migration] Schema contains CHECK (pub_date GLOB ...): ok');

const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') {
  console.error(`[Migration] ERROR: integrity check failed: ${integrity.integrity_check}. Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log('[Migration] Integrity check: ok');

const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
if (fkViolations.length > 0) {
  console.error(`[Migration] ERROR: foreign_key_check reported ${fkViolations.length} violation(s). Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log('[Migration] Foreign key check: ok (0 violations)');

// Live rejection self-test: a garbage pub_date must be rejected. link/title are
// supplied so pub_date is the ONLY possible violation. Everything happens inside
// a SAVEPOINT that is always rolled back, so nothing persists.
db.exec('SAVEPOINT check_test');
let acceptedBad = false;
let rejectionMsg = null;
try {
  db.prepare('INSERT INTO articles (link, title, pub_date) VALUES (?, ?, ?)')
    .run('__constraint_test__', '__test__', 'not-a-date');
  acceptedBad = true; // must NOT reach here
} catch (err) {
  rejectionMsg = err.message;
} finally {
  db.exec('ROLLBACK TO check_test');
  db.exec('RELEASE check_test');
}
if (acceptedBad) {
  console.error('[Migration] ERROR: garbage pub_date was ACCEPTED — CHECK constraint is not active. Restore from backup.');
  db.close();
  process.exit(1);
}
const testResidue = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE link = '__constraint_test__'").get().n;
if (testResidue !== 0) {
  console.error(`[Migration] ERROR: rejection test left ${testResidue} residue row(s). Restore from backup.`);
  db.close();
  process.exit(1);
}
console.log(`[Migration] SAVEPOINT rejection test: bad insert correctly rejected — "${rejectionMsg}"`);
console.log('[Migration] Rejection test residue rows: 0');

console.log('[Migration] Done.');
db.close();
