import cron from 'node-cron';
import { fetchAllFeeds } from './rssFetcher.js';
import { cleanOldArticles, getArticles, saveInsights } from './db.js';
import { generateInsights } from './insightsGenerator.js';

/**
 * Generate and save insights for a single category
 */
async function generateCategoryInsights(articles, category, displayName) {
  const categoryArticles = articles.filter(a => a.category === category);
  if (categoryArticles.length === 0) {
    console.log(`[Scheduler] No articles for ${displayName}, skipping`);
    return null;
  }

  console.log(`[Scheduler] Generating insights for ${displayName} (${categoryArticles.length} articles)...`);
  const insights = await generateInsights(categoryArticles, category);
  await saveInsights(insights, category);
  console.log(`[Scheduler] ${displayName} insights cached`);
  return insights;
}

/**
 * Fetch and cache articles and insights
 */
async function fetchAndCacheContent() {
  console.log('\n[Scheduler] Running news fetch...');
  try {
    await fetchAllFeeds();
    console.log('[Scheduler] Fetch completed successfully');

    // Pre-generate insights for each category
    console.log('[Scheduler] Pre-generating insights by category (parallel)...');
    const articles = await getArticles({});

    if (articles && articles.length > 0) {
      const startTime = Date.now();

      // Generate insights for all categories in parallel
      await Promise.all([
        generateCategoryInsights(articles, 'mortgage', 'Mortgage'),
        generateCategoryInsights(articles, 'product-management', 'Product Management'),
        generateCategoryInsights(articles, 'competitor-intel', 'Competitor Intel')
      ]);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Scheduler] All insights pre-generated and cached successfully in ${elapsed}s`);
    }
  } catch (error) {
    console.error('[Scheduler] Error during fetch:', error);
  }
}

/**
 * Initialize scheduled tasks
 */
export function initScheduler() {
  // Fetch articles immediately on startup
  console.log('[Scheduler] Performing initial fetch on startup...');
  fetchAndCacheContent();

  // Fetch news twice weekly: Monday and Thursday at 8 AM EST
  cron.schedule('0 8 * * 1,4', async () => {
    console.log('\n[Scheduler] Running bi-weekly news fetch (Mon/Thu 8 AM)...');
    await fetchAndCacheContent();
  }, {
    timezone: 'America/New_York'
  });

  // Clean old articles weekly on Sunday at midnight
  cron.schedule('0 0 * * 0', async () => {
    console.log('\n[Scheduler] Running weekly cleanup...');
    try {
      const result = await cleanOldArticles();
      console.log(`[Scheduler] Cleanup completed. Removed ${result.removed} old articles`);
    } catch (error) {
      console.error('[Scheduler] Error during cleanup:', error);
    }
  }, {
    timezone: 'America/New_York'
  });

  console.log('✓ Scheduler initialized');
  console.log('  - Bi-weekly fetch: Monday & Thursday 8:00 AM EST');
  console.log('  - Weekly cleanup: Sunday 12:00 AM EST\n');
}
