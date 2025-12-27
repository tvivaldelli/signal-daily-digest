import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getArticles, getInsights, getTodaysInsights, saveInsights, clearInsights, getArchivedInsights, getArchivedInsightById, searchArchivedInsights } from './db.js';
import { fetchAllFeeds, getSources } from './rssFetcher.js';
import { initScheduler } from './scheduler.js';
import { generateInsights } from './insightsGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// Rate Limiting Middleware
// ============================================
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return next();
  }

  const record = rateLimitStore.get(ip);

  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return next();
  }

  record.count++;

  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000)} seconds.`
    });
  }

  next();
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ============================================
// Input Validation Helpers
// ============================================
function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

function isValidDate(dateStr) {
  if (!dateStr) return true; // Optional dates are valid
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function isValidCategory(category) {
  if (!category) return true; // Optional
  const validCategories = ['mortgage', 'product-management', 'competitor-intel', 'all'];
  return validCategories.includes(category);
}

// ============================================
// Middleware
// ============================================
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true
}));
app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(rateLimit); // Apply rate limiting to all routes

// ============================================
// Cache Control Helpers
// ============================================
function setCacheHeaders(res, maxAge = 300, staleWhileRevalidate = 60) {
  res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
}

function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
}

// Health check endpoint
app.get('/health', (req, res) => {
  setNoCacheHeaders(res);
  res.json({ status: 'ok', message: 'Mortgage News Monitor API is running' });
});

/**
 * GET /api/articles
 * Fetch stored articles with optional filters
 * Query params: category, source, startDate, endDate, keyword
 */
app.get('/api/articles', async (req, res) => {
  try {
    // Validate inputs
    if (!isValidCategory(req.query.category)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category',
        message: 'Category must be one of: mortgage, product-management, competitor-intel, all'
      });
    }

    if (!isValidDate(req.query.startDate) || !isValidDate(req.query.endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Dates must be valid ISO date strings'
      });
    }

    const filters = {
      category: sanitizeString(req.query.category, 50),
      source: sanitizeString(req.query.source, 100),
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      keyword: sanitizeString(req.query.keyword, 100)
    };

    const articles = await getArticles(filters);

    // Cache for 5 minutes (articles don't change frequently)
    setCacheHeaders(res, 300, 60);

    res.json({
      success: true,
      count: articles.length,
      articles
    });
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch articles',
      message: error.message
    });
  }
});

/**
 * POST /api/refresh
 * Manually trigger article fetch from all sources
 */
app.post('/api/refresh', async (req, res) => {
  try {
    console.log('\n[API] Manual refresh triggered...');

    // Clear cached insights since we're refreshing articles
    await clearInsights();

    const articles = await fetchAllFeeds();

    res.json({
      success: true,
      message: 'Articles refreshed successfully',
      count: articles.length,
      articles
    });
  } catch (error) {
    console.error('Error refreshing articles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh articles',
      message: error.message
    });
  }
});

/**
 * GET /api/sources
 * Get list of configured news sources
 */
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await getSources();

    // Cache for 1 hour (sources rarely change)
    setCacheHeaders(res, 3600, 300);

    res.json({
      success: true,
      count: sources.length,
      sources
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sources',
      message: error.message
    });
  }
});

/**
 * GET /api/categories
 * Get list of unique categories from sources
 */
app.get('/api/categories', async (req, res) => {
  try {
    const sources = await getSources();
    const categories = [...new Set(sources.map(s => s.category).filter(Boolean))];

    // Cache for 1 hour (categories rarely change)
    setCacheHeaders(res, 3600, 300);

    res.json({
      success: true,
      count: categories.length,
      categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      message: error.message
    });
  }
});

/**
 * POST /api/insights
 * Generate AI-powered insights from provided articles
 * Body: { articles: [...], category: 'all' | 'mortgage' | 'product-management' }
 */
app.post('/api/insights', async (req, res) => {
  try {
    const { articles, category = 'all' } = req.body;

    if (!articles || !Array.isArray(articles)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'Request body must include an "articles" array'
      });
    }

    // Check for insights generated TODAY (EST timezone)
    // This ensures fresh insights even if server was asleep at 8am cron time
    const todaysInsights = await getTodaysInsights(category);
    if (todaysInsights) {
      console.log(`[API] Returning today's cached insights for category: ${category}`);
      return res.json(todaysInsights);
    }

    // No insights for today - generate fresh ones
    console.log(`\n[API] No insights for today, generating new insights for ${articles.length} articles (category: ${category})...`);

    const insights = await generateInsights(articles);

    // Calculate date range from articles
    const dates = articles.map(a => new Date(a.pubDate)).filter(d => !isNaN(d));
    const dateRangeStart = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
    const dateRangeEnd = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

    // Cache the generated insights with category key (also archives to database)
    await saveInsights(insights, category, dateRangeStart, dateRangeEnd);

    res.json(insights);
  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate insights',
      message: error.message
    });
  }
});

/**
 * GET /api/insights/archive
 * Get archived insights history
 * Query params: category, startDate, endDate, limit
 */
app.get('/api/insights/archive', async (req, res) => {
  try {
    const filters = {
      category: req.query.category,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? parseInt(req.query.limit) : 50
    };

    const archives = await getArchivedInsights(filters);

    // Cache for 10 minutes (archives are historical, change infrequently)
    setCacheHeaders(res, 600, 120);

    res.json({
      success: true,
      count: archives.length,
      archives
    });
  } catch (error) {
    console.error('Error fetching archived insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch archived insights',
      message: error.message
    });
  }
});

/**
 * GET /api/insights/archive/:id
 * Get a specific archived insight by ID
 */
app.get('/api/insights/archive/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'Insight ID must be a number'
      });
    }

    const insight = await getArchivedInsightById(id);

    if (!insight) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Archived insight not found'
      });
    }

    // Cache for 1 hour (archived insights are immutable)
    setCacheHeaders(res, 3600, 300);

    res.json(insight);
  } catch (error) {
    console.error('Error fetching archived insight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch archived insight',
      message: error.message
    });
  }
});

/**
 * GET /api/insights/search
 * Search archived insights by keyword
 * Query params: q (required), category
 */
app.get('/api/insights/search', async (req, res) => {
  try {
    const keyword = req.query.q;

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: 'Missing keyword',
        message: 'Search query "q" is required'
      });
    }

    const filters = {
      category: req.query.category
    };

    const results = await searchArchivedInsights(keyword, filters);

    // Cache search results for 5 minutes
    setCacheHeaders(res, 300, 60);

    res.json({
      success: true,
      query: keyword,
      count: results.length,
      results
    });
  } catch (error) {
    console.error('Error searching insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search insights',
      message: error.message
    });
  }
});

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../client/dist')));

// Serve index.html for all non-API routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 News Monitor API running on port ${PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   GET  /api/articles - Fetch articles`);
  console.log(`   POST /api/refresh - Refresh articles`);
  console.log(`   GET  /api/sources - List sources`);
  console.log(`   GET  /api/categories - List categories`);
  console.log(`   POST /api/insights - Generate AI insights`);
  console.log(`   GET  /api/insights/archive - Browse archived insights`);
  console.log(`   GET  /api/insights/archive/:id - Get specific archived insight`);
  console.log(`   GET  /api/insights/search?q=keyword - Search archived insights\n`);

  // Initialize scheduler
  initScheduler();
});

export default app;
