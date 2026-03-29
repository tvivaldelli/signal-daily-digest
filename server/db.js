import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const dbDir = join(homedir(), '.local', 'share', 'signal-digest');
mkdirSync(dbDir, { recursive: true });

const db = new Database(join(dbDir, 'articles.db'));

// WAL mode: concurrent readers don't block writers
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
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
    pub_date TEXT,
    saved_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
  CREATE INDEX IF NOT EXISTS idx_category ON articles(category);
  CREATE INDEX IF NOT EXISTS idx_pub_date ON articles(pub_date);
  CREATE INDEX IF NOT EXISTS idx_saved_at ON articles(saved_at);
`);

console.log('[DB] Database initialized');

function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    link: row.link,
    pubDate: row.pub_date,
    source: row.source,
    category: row.category,
    type: row.type || 'article',
    summary: row.summary,
    originalContent: row.original_content,
    imageUrl: row.image_url,
    contentHtml: row.content_html,
    hasFullContent: !!row.has_full_content
  };
}

/**
 * Store an article in the database
 */
export async function saveArticle(article) {
  try {
    const { title, link, pubDate, source, category, summary, originalContent, imageUrl, type, contentHtml, hasFullContent } = article;

    db.prepare(`
      INSERT INTO articles (title, link, pub_date, source, category, type, summary, original_content, image_url, content_html, has_full_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (link) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        type = excluded.type,
        summary = excluded.summary,
        original_content = excluded.original_content,
        image_url = excluded.image_url,
        content_html = excluded.content_html,
        has_full_content = excluded.has_full_content
    `).run(
      title || '',
      link || '',
      pubDate || new Date().toISOString(),
      source || '',
      category || '',
      type || 'article',
      summary || '',
      originalContent || '',
      imageUrl || null,
      contentHtml || null,
      hasFullContent ? 1 : 0
    );

    console.log(`[DB] Article saved: ${title.substring(0, 50)}`);
    return article;
  } catch (error) {
    console.error('[DB] Error saving article:', error.message);
    throw error;
  }
}

/**
 * Retrieve all articles with optional filters
 */
export async function getArticles(filters = {}) {
  try {
    let query = 'SELECT * FROM articles WHERE 1=1';
    const params = [];

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.startDate) {
      query += ' AND pub_date >= ?';
      params.push(new Date(filters.startDate).toISOString());
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      query += ' AND pub_date <= ?';
      params.push(endDate.toISOString());
    }

    if (filters.keyword) {
      const keyword = `%${filters.keyword}%`;
      query += ' AND (title LIKE ? OR summary LIKE ?)';
      params.push(keyword, keyword);
    }

    query += ' ORDER BY pub_date DESC LIMIT 100';

    const rows = db.prepare(query).all(...params);
    const articles = rows.map(mapRow);

    console.log(`[DB] Retrieved ${articles.length} articles`);
    return articles;
  } catch (error) {
    console.error('[DB] Error retrieving articles:', error.message);
    return [];
  }
}

/**
 * Get unique sources
 */
export async function getSources() {
  try {
    const rows = db.prepare(
      'SELECT DISTINCT source FROM articles WHERE source IS NOT NULL ORDER BY source'
    ).all();
    return rows.map(row => row.source);
  } catch (error) {
    console.error('[DB] Error getting sources:', error.message);
    return [];
  }
}

/**
 * Clear old articles (older than 90 days)
 */
export async function cleanOldArticles() {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = db.prepare(
      'DELETE FROM articles WHERE pub_date < ?'
    ).run(ninetyDaysAgo.toISOString());

    console.log(`[DB] Cleaned ${result.changes} old articles`);
    return { removed: result.changes };
  } catch (error) {
    console.error('[DB] Error cleaning old articles:', error.message);
    return { removed: 0 };
  }
}

/**
 * Get a single article by ID (for reader endpoint)
 */
export async function getArticleById(id) {
  try {
    const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!row) return null;
    return mapRow(row);
  } catch (error) {
    console.error('[DB] Error getting article by ID:', error.message);
    return null;
  }
}

export default {
  saveArticle,
  getArticles,
  getArticleById,
  getSources,
  cleanOldArticles
};
