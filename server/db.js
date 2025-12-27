import pkg from 'pg';
const { Pool } = pkg;

// Initialize database connection pool with explicit configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                      // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,     // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000 // Timeout acquiring a connection after 5 seconds
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

    // Create insights_archive table for persistent insights storage
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insights_archive (
        id SERIAL PRIMARY KEY,
        category VARCHAR(255) NOT NULL,
        tldr JSONB,
        recommended_actions JSONB,
        themes JSONB,
        article_count INTEGER,
        date_range_start TIMESTAMP,
        date_range_end TIMESTAMP,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_insights_category ON insights_archive(category);
      CREATE INDEX IF NOT EXISTS idx_insights_generated_at ON insights_archive(generated_at DESC);
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

// ============================================
// LRU Cache Implementation
// ============================================
class LRUCache {
  constructor(maxSize = 10, ttlMs = 24 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs; // Default 24 hour TTL
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    const entry = this.cache.get(key);

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      console.log(`[Cache] Entry expired for key: ${key}`);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key, value) {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      console.log(`[Cache] Evicted oldest entry: ${oldestKey}`);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  has(key) {
    if (!this.cache.has(key)) return false;
    const entry = this.cache.get(key);
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  size() {
    return this.cache.size;
  }
}

// In-memory insights cache with LRU eviction (max 10 entries, 24hr TTL)
const insightsCache = new LRUCache(10, 24 * 60 * 60 * 1000);

/**
 * Save insights to cache AND optionally persist to database archive
 * @param {boolean} shouldArchive - Only archive if this is a newly generated insight (not from cache)
 */
export async function saveInsights(insights, category = 'all', dateRangeStart = null, dateRangeEnd = null, shouldArchive = true) {
  try {
    // Update LRU cache
    insightsCache.set(category, {
      ...insights,
      cachedAt: new Date().toISOString()
    });
    console.log(`[DB] ✓ Insights cached for category: ${category} (cache size: ${insightsCache.size()})`);

    // Only persist to database archive if explicitly requested (new insights, not cached)
    if (shouldArchive) {
      await archiveInsights(insights, category, dateRangeStart, dateRangeEnd);
    }

    return insightsCache.get(category);
  } catch (error) {
    console.error('[DB] Error saving insights:', error.message);
    return null;
  }
}

/**
 * Archive insights to persistent database storage
 * Prevents duplicate archives on the same day (EST timezone) for the same category
 * Skips archiving for 'all' category and empty/failed insights
 */
export async function archiveInsights(insights, category, dateRangeStart = null, dateRangeEnd = null) {
  try {
    // Skip archiving 'all' category - only archive specific categories for richer insights
    if (category === 'all') {
      console.log(`[DB] Skipping archive for 'all' category - only specific categories are archived`);
      return null;
    }

    // Skip archiving if insights are empty or failed
    if (!insights.success || !insights.themes || insights.themes.length === 0) {
      console.log(`[DB] Skipping archive - insights are empty or failed for ${category}`);
      return null;
    }

    // Check if we already have an archive for this category within the last 3 days
    // This prevents duplicates within the Mon-Thu bi-weekly window
    const recentCheck = await pool.query(
      `SELECT id FROM insights_archive
       WHERE category = $1
       AND generated_at > NOW() - INTERVAL '3 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [category]
    );

    // Prepare the data
    const tldr = JSON.stringify(insights.tldr || []);
    const recommendedActions = JSON.stringify(insights.recommendedActions || []);
    const themes = JSON.stringify(insights.themes || []);
    const articleCount = insights.articleCount || 0;
    const rangeStart = dateRangeStart || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const rangeEnd = dateRangeEnd || new Date().toISOString();
    const generatedAt = insights.generatedAt || new Date().toISOString();

    if (recentCheck.rows.length > 0) {
      // UPDATE existing entry instead of skipping (prevents race condition duplicates)
      const existingId = recentCheck.rows[0].id;
      await pool.query(
        `UPDATE insights_archive SET
           tldr = $1,
           recommended_actions = $2,
           themes = $3,
           article_count = $4,
           date_range_start = $5,
           date_range_end = $6,
           generated_at = $7
         WHERE id = $8`,
        [tldr, recommendedActions, themes, articleCount, rangeStart, rangeEnd, generatedAt, existingId]
      );
      console.log(`[DB] ✓ Updated existing archive for ${category} (ID: ${existingId})`);
      return existingId;
    }

    const result = await pool.query(
      `INSERT INTO insights_archive
       (category, tldr, recommended_actions, themes, article_count, date_range_start, date_range_end, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [category, tldr, recommendedActions, themes, articleCount, rangeStart, rangeEnd, generatedAt]
    );

    console.log(`[DB] ✓ Insights archived with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error('[DB] Error archiving insights:', error.message);
    return null;
  }
}

/**
 * Get cached insights (from memory first, then database)
 * This provides persistent caching that survives server restarts
 */
export async function getInsights(category = 'all') {
  try {
    // First check LRU cache
    const cached = insightsCache.get(category);
    if (cached) {
      console.log(`[DB] ✓ Returning LRU cached insights for category: ${category}`);
      return cached;
    }

    // If not in memory, check database for recent insights (within 4 days for bi-weekly cadence)
    // Skip 'all' category as we only archive specific categories
    if (category !== 'all') {
      const result = await pool.query(
        `SELECT * FROM insights_archive
         WHERE category = $1 AND generated_at > NOW() - INTERVAL '4 days'
         ORDER BY generated_at DESC LIMIT 1`,
        [category]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const insights = {
          success: true,
          tldr: row.tldr,
          recommendedActions: row.recommended_actions,
          themes: row.themes,
          articleCount: row.article_count,
          generatedAt: row.generated_at
        };

        // Populate LRU cache for faster subsequent requests
        insightsCache.set(category, {
          ...insights,
          cachedAt: new Date().toISOString()
        });

        console.log(`[DB] ✓ Restored insights from database for category: ${category} (generated ${row.generated_at})`);
        return insights;
      }
    }

    return null;
  } catch (error) {
    console.error('[DB] Error getting insights:', error.message);
    return null;
  }
}

/**
 * Check if we have fresh insights generated today (in EST timezone)
 * Returns the insights if fresh, null if stale or missing
 */
export async function getTodaysInsights(category) {
  try {
    if (category === 'all') {
      return null; // We don't cache 'all' category
    }

    // Check LRU cache first
    const cached = insightsCache.get(category);
    if (cached && cached.generatedAt && isGeneratedRecently(cached.generatedAt)) {
      console.log(`[DB] ✓ Found recent insights in LRU cache for: ${category}`);
      return cached;
    }

    // Check database for insights generated within recent window (3 days for bi-weekly cadence)
    const result = await pool.query(
      `SELECT * FROM insights_archive
       WHERE category = $1
       AND generated_at > NOW() - INTERVAL '3 days'
       ORDER BY generated_at DESC LIMIT 1`,
      [category]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const insights = {
        success: true,
        tldr: row.tldr,
        recommendedActions: row.recommended_actions,
        themes: row.themes,
        articleCount: row.article_count,
        generatedAt: row.generated_at
      };

      // Populate LRU cache
      insightsCache.set(category, {
        ...insights,
        cachedAt: new Date().toISOString()
      });

      console.log(`[DB] ✓ Found recent insights in database for: ${category}`);
      return insights;
    }

    console.log(`[DB] No recent insights found for category: ${category}`);
    return null;
  } catch (error) {
    console.error('[DB] Error getting today\'s insights:', error.message);
    return null;
  }
}

/**
 * Helper to check if a timestamp is within recent window (for bi-weekly cadence)
 * @param {string} generatedAt - ISO timestamp
 * @param {number} windowDays - Number of days to consider "recent" (default 3 for Mon-Thu gap)
 */
function isGeneratedRecently(generatedAt, windowDays = 3) {
  const generated = new Date(generatedAt);
  const now = new Date();
  const diffMs = now - generated;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays < windowDays;
}

/**
 * Get archived insights history from database
 * @param {Object} filters - { category, startDate, endDate, limit }
 */
export async function getArchivedInsights(filters = {}) {
  try {
    // Only show historical insights (before today in EST timezone)
    let query = `SELECT * FROM insights_archive
                 WHERE DATE(generated_at AT TIME ZONE 'America/New_York') < DATE(NOW() AT TIME ZONE 'America/New_York')`;
    const params = [];
    let paramIndex = 1;

    if (filters.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    if (filters.startDate) {
      query += ` AND generated_at >= $${paramIndex}`;
      params.push(new Date(filters.startDate).toISOString());
      paramIndex++;
    }

    if (filters.endDate) {
      query += ` AND generated_at <= $${paramIndex}`;
      params.push(new Date(filters.endDate).toISOString());
      paramIndex++;
    }

    query += ' ORDER BY generated_at DESC';

    const limit = filters.limit || 50;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    // Format results
    const archives = result.rows.map(row => ({
      id: row.id,
      category: row.category,
      tldr: row.tldr,
      recommendedActions: row.recommended_actions,
      themes: row.themes,
      articleCount: row.article_count,
      dateRangeStart: row.date_range_start,
      dateRangeEnd: row.date_range_end,
      generatedAt: row.generated_at
    }));

    console.log(`[DB] Retrieved ${archives.length} archived insights`);
    return archives;
  } catch (error) {
    console.error('[DB] Error getting archived insights:', error.message);
    return [];
  }
}

/**
 * Get a single archived insight by ID
 */
export async function getArchivedInsightById(id) {
  try {
    const result = await pool.query(
      'SELECT * FROM insights_archive WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      tldr: row.tldr,
      recommendedActions: row.recommended_actions,
      themes: row.themes,
      articleCount: row.article_count,
      dateRangeStart: row.date_range_start,
      dateRangeEnd: row.date_range_end,
      generatedAt: row.generated_at,
      success: true // Match the format expected by frontend
    };
  } catch (error) {
    console.error('[DB] Error getting archived insight:', error.message);
    return null;
  }
}

/**
 * Search archived insights by keyword
 */
export async function searchArchivedInsights(keyword, filters = {}) {
  try {
    let query = `
      SELECT * FROM insights_archive
      WHERE (
        tldr::text ILIKE $1
        OR recommended_actions::text ILIKE $1
        OR themes::text ILIKE $1
      )
    `;
    const params = [`%${keyword}%`];
    let paramIndex = 2;

    if (filters.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    query += ' ORDER BY generated_at DESC LIMIT 50';

    const result = await pool.query(query, params);

    const archives = result.rows.map(row => ({
      id: row.id,
      category: row.category,
      tldr: row.tldr,
      recommendedActions: row.recommended_actions,
      themes: row.themes,
      articleCount: row.article_count,
      dateRangeStart: row.date_range_start,
      dateRangeEnd: row.date_range_end,
      generatedAt: row.generated_at
    }));

    console.log(`[DB] Found ${archives.length} insights matching "${keyword}"`);
    return archives;
  } catch (error) {
    console.error('[DB] Error searching archived insights:', error.message);
    return [];
  }
}

/**
 * Clear cached insights
 */
export async function clearInsights(category = null) {
  try {
    if (category) {
      insightsCache.delete(category);
      console.log(`[DB] ✓ Insights cache cleared for category: ${category}`);
    } else {
      insightsCache.clear();
      console.log('[DB] ✓ All insights cache cleared');
    }
    return true;
  } catch (error) {
    console.error('[DB] Error clearing insights:', error.message);
    return false;
  }
}

/**
 * Clean up blank/empty insights from archive (one-time maintenance)
 */
async function cleanupBlankInsights() {
  try {
    const result = await pool.query(
      `DELETE FROM insights_archive
       WHERE themes IS NULL
          OR themes = '[]'::jsonb
          OR themes = 'null'::jsonb
          OR jsonb_array_length(themes) = 0
          OR article_count = 0
          OR article_count IS NULL
       RETURNING id, category, generated_at`
    );

    if (result.rowCount > 0) {
      console.log(`[DB] ✓ Cleaned up ${result.rowCount} blank/empty insight entries`);
      result.rows.forEach(row => {
        console.log(`[DB]   - Removed ID ${row.id} (${row.category}, ${row.generated_at})`);
      });
    }
  } catch (error) {
    console.error('[DB] Error cleaning up blank insights:', error.message);
  }
}

/**
 * Deduplicate archive entries - keep only one entry per category per day (EST timezone)
 * Keeps the most recent valid entry for each category/date combination
 */
async function deduplicateArchiveEntries() {
  try {
    // First, get the IDs we want to keep (most recent valid entry per category per day)
    const keepResult = await pool.query(`
      SELECT DISTINCT ON (category, DATE(generated_at AT TIME ZONE 'America/New_York'))
             id
      FROM insights_archive
      WHERE themes IS NOT NULL
        AND themes != '[]'::jsonb
        AND jsonb_array_length(themes) > 0
      ORDER BY category, DATE(generated_at AT TIME ZONE 'America/New_York'), generated_at DESC
    `);

    const idsToKeep = keepResult.rows.map(row => row.id);

    if (idsToKeep.length === 0) {
      console.log('[DB] No valid archive entries found to keep');
      return;
    }

    // Delete all entries NOT in the keep list
    const deleteResult = await pool.query(
      `DELETE FROM insights_archive
       WHERE id != ALL($1::int[])
       RETURNING id, category, generated_at`,
      [idsToKeep]
    );

    if (deleteResult.rowCount > 0) {
      console.log(`[DB] ✓ Deduplicated archive: removed ${deleteResult.rowCount} duplicate entries`);
      deleteResult.rows.forEach(row => {
        console.log(`[DB]   - Removed duplicate ID ${row.id} (${row.category}, ${row.generated_at})`);
      });
    } else {
      console.log('[DB] ✓ No duplicate archive entries found');
    }
  } catch (error) {
    console.error('[DB] Error deduplicating archive entries:', error.message);
  }
}

// Initialize database when module loads
initDB().then(async () => {
  // Run cleanup after DB is initialized
  await cleanupBlankInsights();
  // Deduplicate to ensure only one entry per category per day
  await deduplicateArchiveEntries();
});

export default {
  saveArticle,
  getArticles,
  getSources,
  cleanOldArticles,
  saveInsights,
  getInsights,
  getTodaysInsights,
  clearInsights,
  archiveInsights,
  getArchivedInsights,
  getArchivedInsightById,
  searchArchivedInsights
};
