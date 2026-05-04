#!/usr/bin/env node

/**
 * Dedup status report — shows featured_articles state
 * Usage: npm run dedup:status
 */

import { db, VALID_SECTIONS } from '../server/db.js';

const sections = [...VALID_SECTIONS];

// --- Counts by section ---
console.log('\n=== Featured Articles by Section ===\n');
for (const section of sections) {
  const row = db.prepare('SELECT COUNT(*) as count FROM featured_articles WHERE section = ?').get(section);
  console.log(`  ${section}: ${row.count}`);
}
const total = db.prepare('SELECT COUNT(*) as count FROM featured_articles').get();
console.log(`  TOTAL: ${total.count}`);

// --- 10 most recently featured per section ---
console.log('\n=== 10 Most Recently Featured (per section) ===\n');
for (const section of sections) {
  const rows = db.prepare(`
    SELECT url, title, last_featured_date, feature_count
    FROM featured_articles
    WHERE section = ?
    ORDER BY last_featured_date DESC
    LIMIT 10
  `).all(section);

  console.log(`--- ${section} ---`);
  if (rows.length === 0) {
    console.log('  (none)\n');
    continue;
  }
  for (const row of rows) {
    const title = (row.title || '(no title)').substring(0, 60);
    console.log(`  [${row.last_featured_date}] (${row.feature_count}x) ${title}`);
    console.log(`    ${row.url}`);
  }
  console.log('');
}

// --- Worst offenders: featured 3+ times ---
console.log('=== Worst Offenders (featured 3+ times) ===\n');
const offenders = db.prepare(`
  SELECT url, title, section, feature_count, first_featured_date, last_featured_date
  FROM featured_articles
  WHERE feature_count >= 3
  ORDER BY feature_count DESC
`).all();

if (offenders.length === 0) {
  console.log('  (none — dedup is working)\n');
} else {
  for (const row of offenders) {
    const title = (row.title || '(no title)').substring(0, 60);
    console.log(`  ${row.feature_count}x | ${row.section} | ${title}`);
    console.log(`    ${row.url}`);
    console.log(`    First: ${row.first_featured_date}  Last: ${row.last_featured_date}`);
  }
  console.log('');
}

process.exit(0);
