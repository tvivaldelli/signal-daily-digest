#!/usr/bin/env node

/**
 * Truncate the featured_articles table after confirmation
 * Usage: npm run dedup:reset
 */

import { createInterface } from 'readline';
import { db } from '../server/db.js';

const count = db.prepare('SELECT COUNT(*) as count FROM featured_articles').get().count;

if (count === 0) {
  console.log('featured_articles is already empty. Nothing to reset.');
  process.exit(0);
}

console.log(`\nThis will delete all ${count} rows from featured_articles.`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question('Are you sure? (yes/no): ', (answer) => {
  rl.close();

  if (answer.trim().toLowerCase() === 'yes') {
    db.prepare('DELETE FROM featured_articles').run();
    console.log(`Deleted ${count} rows. featured_articles is now empty.`);
  } else {
    console.log('Aborted.');
  }

  process.exit(0);
});
