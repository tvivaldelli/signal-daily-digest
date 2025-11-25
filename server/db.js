import pkg from 'pg';
const { Pool } = pkg;

// Initialize database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Initialize database tables on startup
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id SERIAL PRIMARY KEY,
        link VARCHAR(2048) UNIQUE NOT NULL,
        title TEXT NOT NULL,
        source VARCHAR(255),
        category VARCHAR(255),
        summary TEXT,
        original_content TEXT,
        image_url TEXT,
        pub_date TIMESTAMP,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add missing columns to existing table (if they don't exist)
    try {
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
      await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT`);
    } catch (alterError) {
      // Columns might already exist, that's okay
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
      CREATE INDEX IF NOT EXISTS idx_category ON articles(category);
      CREATE INDEX IF NOT EXISTS idx_pub_date ON articles(pub_date);
      CREATE INDEX IF NOT EXISTS idx_saved_at ON articles(saved_at);
    `);

    console.log('[DB] ✓ Database initialized');
  } catch (error) {
    console.error('[DB] Error initializing database:', error.message);
  }
}

/**
 * Store an article in the database
 */
export async function saveArticle(article) {
  try {
    const { title, link, pubDate, source, category, summary, originalContent, imageUrl } = article;

    await pool.query(
      `INSERT INTO articles (title, link, pub_date, source, category, summary, original_content, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (link) DO UPDATE SET
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         summary = EXCLUDED.summary,
         original_content = EXCLUDED.original_content,
         image_url = EXCLUDED.image_url
       `,
      [
        title || '',
        link || '',
        pubDate || new Date().toISOString(),
        source || '',
        category || '',
        (summary || '').substring(0, 5000),
        (originalContent || '').substring(0, 5000),
        imageUrl || null
      ]
    );

    console.log(`[DB] ✓ Article saved: ${title.substring(0, 50)}`);
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
    
    // Format results to match expected structure
    const articles = result.rows.map(row => ({
      title: row.title,
      link: row.link,
      pubDate: row.pub_date,
      source: row.source,
      category: row.category,
      summary: row.summary,
      originalContent: row.original_content,
      imageUrl: row.image_url
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

// In-memory insights cache (keyed by category)
let cachedInsightsData = {};

/**
 * Save insights to cache
 */
export async function saveInsights(insights, category = 'all') {
  try {
    cachedInsightsData[category] = {
      ...insights,
      cachedAt: new Date().toISOString()
    };
    console.log(`[DB] ✓ Insights cached for category: ${category}`);
    return cachedInsightsData[category];
  } catch (error) {
    console.error('[DB] Error saving insights:', error.message);
    return null;
  }
}

/**
 * Get cached insights
 */
export async function getInsights(category = 'all') {
  try {
    if (cachedInsightsData[category]) {
      console.log(`[DB] ✓ Returning cached insights for category: ${category}`);
      return cachedInsightsData[category];
    }
    return null;
  } catch (error) {
    console.error('[DB] Error getting insights:', error.message);
    return null;
  }
}

/**
 * Clear cached insights
 */
export async function clearInsights(category = null) {
  try {
    if (category) {
      delete cachedInsightsData[category];
      console.log(`[DB] ✓ Insights cache cleared for category: ${category}`);
    } else {
      cachedInsightsData = {};
      console.log('[DB] ✓ All insights cache cleared');
    }
    return true;
  } catch (error) {
    console.error('[DB] Error clearing insights:', error.message);
    return false;
  }
}

// Initialize database when module loads
initDB();

export default { 
  saveArticle, 
  getArticles, 
  getSources,
  cleanOldArticles, 
  saveInsights,
  getInsights,
  clearInsights 
};
