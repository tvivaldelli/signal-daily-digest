/**
 * One-time migration script: Export insights_archive from PostgreSQL to JSONL
 *
 * Usage: node server/migrate-archive.js
 *
 * 1. Connects to PostgreSQL via DATABASE_URL
 * 2. Exports all insights_archive rows to server/data/signal-archive-legacy.jsonl
 * 3. Drops the insights_archive table
 */

import dotenv from 'dotenv';
import pkg from 'pg';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'signal-archive-legacy.jsonl');

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('[Migration] Connected to PostgreSQL');

    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'insights_archive'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('[Migration] insights_archive table does not exist. Nothing to migrate.');
      return;
    }

    // Export all rows
    const result = await client.query(
      'SELECT id, category, tldr, recommended_actions, themes, article_count, date_range_start, date_range_end, generated_at FROM insights_archive ORDER BY generated_at ASC'
    );

    console.log(`[Migration] Found ${result.rows.length} archive entries`);

    if (result.rows.length > 0) {
      await mkdir(DATA_DIR, { recursive: true });

      // Write each row as a JSON line
      for (const row of result.rows) {
        const entry = {
          id: row.id,
          category: row.category,
          tldr: row.tldr,
          recommended_actions: row.recommended_actions,
          themes: row.themes,
          article_count: row.article_count,
          date_range_start: row.date_range_start,
          date_range_end: row.date_range_end,
          generated_at: row.generated_at,
        };
        await appendFile(OUTPUT_PATH, JSON.stringify(entry) + '\n', 'utf8');
      }

      console.log(`[Migration] Exported ${result.rows.length} entries to ${OUTPUT_PATH}`);
    }

    // Drop the table
    await client.query('DROP TABLE insights_archive');
    console.log('[Migration] Dropped insights_archive table');

    console.log('[Migration] Complete!');
  } catch (error) {
    console.error('[Migration] Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
