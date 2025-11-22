import cron from 'node-cron';
import { fetchAllFeeds } from './rssFetcher.js';
import { cleanOldArticles, getArticles, saveInsights } from './db.js';
import { generateInsights } from './insightsGenerator.js';

/**
 * Fetch and cache articles and insights
 */
async function fetchAndCacheContent() {
  console.log('\n[Scheduler] Running news fetch...');
  try {
    await fetchAllFeeds();
    console.log('[Scheduler] Fetch completed successfully');

    // Pre-generate insights for the fetched articles
    console.log('[Scheduler] Pre-generating insights...');
    const articles = await getArticles({});
    if (articles && articles.length > 0) {
      const insights = await generateInsights(articles);
      await saveInsights(insights);
      console.log('[Scheduler] Insights pre-generated and cached');
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

  // Fetch news daily at 8 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('\n[Scheduler] Running daily news fetch at 8 AM...');
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
  console.log('  - Daily fetch: 8:00 AM EST');
  console.log('  - Weekly cleanup: Sunday 12:00 AM EST\n');
}
