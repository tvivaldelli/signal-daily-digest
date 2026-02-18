import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id SERIAL PRIMARY KEY,
        link VARCHAR(2048) UNIQUE NOT NULL,
        title TEXT NOT NULL,
        source VARCHAR(255),
        category VARCHAR(255),
        type VARCHAR(50) DEFAULT 'article',
        summary TEXT,
        original_content TEXT,
        image_url TEXT,
        pub_date TIMESTAMP,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add missing columns to existing table
    try {
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT`);
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'article'`);
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_html TEXT`);
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS has_full_content BOOLEAN DEFAULT false`);
    } catch (alterError) {
      // Columns might already exist
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
      CREATE INDEX IF NOT EXISTS idx_category ON articles(category);
      CREATE INDEX IF NOT EXISTS idx_pub_date ON articles(pub_date);
      CREATE INDEX IF NOT EXISTS idx_saved_at ON articles(saved_at);
    `);

    console.log('[DB] Database initialized');
  } catch (error) {
    console.error('[DB] Error initializing database:', error.message);
  }
}

/**
 * Store an article in the database
 */
export async function saveArticle(article) {
  try {
    const { title, link, pubDate, source, category, summary, originalContent, imageUrl, type, contentHtml, hasFullContent } = article;

    await pool.query(
      `INSERT INTO articles (title, link, pub_date, source, category, type, summary, original_content, image_url, content_html, has_full_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (link) DO UPDATE SET
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         type = EXCLUDED.type,
         summary = EXCLUDED.summary,
         original_content = EXCLUDED.original_content,
         image_url = EXCLUDED.image_url,
         content_html = EXCLUDED.content_html,
         has_full_content = EXCLUDED.has_full_content
       `,
      [
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
        hasFullContent || false
      ]
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
    let paramIndex = 1;

    if (filters.source) {
      query += ` AND source = $${paramIndex}`;
      params.push(filters.source);
      paramIndex++;
    }

    if (filters.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    if (filters.startDate) {
      query += ` AND pub_date >= $${paramIndex}`;
      params.push(new Date(filters.startDate).toISOString());
      paramIndex++;
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      query += ` AND pub_date <= $${paramIndex}`;
      params.push(endDate.toISOString());
      paramIndex++;
    }

    if (filters.keyword) {
      const keyword = `%${filters.keyword}%`;
      query += ` AND (title ILIKE $${paramIndex} OR summary ILIKE $${paramIndex})`;
      params.push(keyword);
      params.push(keyword);
      paramIndex += 2;
    }

    query += ' ORDER BY pub_date DESC LIMIT 100';

    const result = await pool.query(query, params);

    const articles = result.rows.map(row => ({
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
      hasFullContent: row.has_full_content || false
    }));

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
    const result = await pool.query(
      'SELECT DISTINCT source FROM articles WHERE source IS NOT NULL ORDER BY source'
    );
    return result.rows.map(row => row.source);
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

    const result = await pool.query(
      'DELETE FROM articles WHERE pub_date < $1',
      [ninetyDaysAgo.toISOString()]
    );

    console.log(`[DB] Cleaned ${result.rowCount} old articles`);
    return { removed: result.rowCount };
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
    const result = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
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
      hasFullContent: row.has_full_content || false
    };
  } catch (error) {
    console.error('[DB] Error getting article by ID:', error.message);
    return null;
  }
}

// Initialize database when module loads
initDB();

export default {
  saveArticle,
  getArticles,
  getArticleById,
  getSources,
  cleanOldArticles
};
