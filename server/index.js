import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getArticles } from './db.js';
import { fetchAllFeeds, getSources } from './rssFetcher.js';
import { initScheduler } from './scheduler.js';

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
 * Query params: source, startDate, endDate, keyword
 */
app.get('/api/articles', async (req, res) => {
  try {
    const filters = {
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
  console.log(`\n🚀 Mortgage News Monitor API running on port ${PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   GET  /api/articles - Fetch articles`);
  console.log(`   POST /api/refresh - Refresh articles`);
  console.log(`   GET  /api/sources - List sources\n`);

  // Initialize scheduler
  initScheduler();
});

export default app;
