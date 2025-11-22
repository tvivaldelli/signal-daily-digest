import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getArticles, getInsights, saveInsights, clearInsights } from './db.js';
import { fetchAllFeeds, getSources } from './rssFetcher.js';
import { initScheduler } from './scheduler.js';
import { generateInsights } from './insightsGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mortgage News Monitor API is running' });
});

/**
 * GET /api/articles
 * Fetch stored articles with optional filters
 * Query params: category, source, startDate, endDate, keyword
 */
app.get('/api/articles', async (req, res) => {
  try {
    const filters = {
      category: req.query.category,
      source: req.query.source,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      keyword: req.query.keyword
    };

    const articles = await getArticles(filters);

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

    // Check for cached insights for this specific category
    const cachedInsights = await getInsights(category);
    if (cachedInsights) {
      console.log(`[API] Returning cached insights for category: ${category}`);
      return res.json(cachedInsights);
    }

    console.log(`\n[API] Generating insights for ${articles.length} articles (category: ${category})...`);

    const insights = await generateInsights(articles);

    // Cache the generated insights with category key
    await saveInsights(insights, category);

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
  console.log(`   POST /api/insights - Generate AI insights\n`);

  // Initialize scheduler
  initScheduler();
});

export default app;
