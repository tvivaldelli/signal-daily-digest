import { appendFile, readFile, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_PATH = path.join(DATA_DIR, 'signal-archive.jsonl');

/**
 * Ensure the data directory exists
 */
async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

/**
 * Append a digest object as a single JSON line to the archive file
 * @param {Object} digestObj - The digest data to archive
 */
export async function appendDigest(digestObj) {
  await ensureDataDir();
  const line = JSON.stringify(digestObj) + '\n';
  await appendFile(ARCHIVE_PATH, line, 'utf8');
  console.log(`[Archiver] Digest appended to ${ARCHIVE_PATH}`);
}

/**
 * Read the last N digest entries from the archive file (newest first)
 * @param {number} count - Number of recent entries to return
 * @returns {Promise<Array>} Parsed digest objects, newest first
 */
export async function readRecentDigests(count = 5) {
  try {
    const content = await readFile(ARCHIVE_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const recent = lines.slice(-count).reverse();
    return recent.map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[Archiver] No archive file found, returning empty array');
      return [];
    }
    console.error('[Archiver] Error reading digests:', error.message);
    return [];
  }
}
