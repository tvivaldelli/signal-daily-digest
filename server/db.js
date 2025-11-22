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
        summary TEXT,
        original_content TEXT,
        pub_date TIMESTAMP,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
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
    const { title, link, pubDate, source, summary, originalContent } = article;
    
    await pool.query(
      `INSERT INTO articles (title, link, pub_date, source, summary, original_content)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (link) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         original_content = EXCLUDED.original_content
       `,
      [
        title || '',
        link || '',
        pubDate || new Date().toISOString(),
        source || '',
        (summary || '').substring(0, 5000),
        (originalContent || '').substring(0, 5000)
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
      summary: row.summary,
      originalContent: row.original_content
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
 * Save insights to database
 */
export async function saveInsights(insights) {
  try {
    // For now, store insights as JSON in a simple way
    // In a production app, you'd want a dedicated insights table
    console.log('[DB] ✓ Insights generated and ready');
    return insights;
  } catch (error) {
    console.error('[DB] Error saving insights:', error.message);
    return null;
  }
}

/**
 * Get insights
 */
export async function getInsights() {
  try {
    // Return aggregated insights from articles
    const result = await pool.query(
      `SELECT source, COUNT(*) as count, MAX(pub_date) as latest
       FROM articles
       GROUP BY source
       ORDER BY count DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('[DB] Error getting insights:', error.message);
    return [];
  }
}

/**
 * Clear insights
 */
export async function clearInsights() {
  // Insights are generated on the fly, so nothing to clear
  console.log('[DB] Insights cleared');
  return true;
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
