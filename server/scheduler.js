import cron from 'node-cron';
import { fetchAllFeeds } from './rssFetcher.js';
import { getArticles, cleanOldArticles } from './db.js';
import { generateInsights, generateWeeklySummary } from './insightsGenerator.js';
import { sendDigestEmail } from './emailSender.js';
import { appendDigest, readRecentDigests } from './archiver.js';

/**
 * In-memory state for the /health endpoint
 */
export const digestState = {
  lastDigestRun: null,
  articleCount: 0,
  emailStatus: null,
  nextScheduledRun: null,
  lastError: null
};

/**
 * Run the full daily digest pipeline
 */
export async function runDailyDigest() {
  const startTime = Date.now();
  console.log(`\n[Signal] Starting daily digest pipeline at ${new Date().toISOString()}`);

  try {
    // 1. Fetch RSS + scrape newsrooms
    await fetchAllFeeds();

    // 2. Query articles from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const articles = await getArticles({ startDate: since.toISOString() });

    digestState.articleCount = articles.length;
    console.log(`[Signal] ${articles.length} articles from last 24 hours`);

    // 3. Zero articles → send "nothing new" email, skip Claude
    if (articles.length === 0) {
      const emptyDigest = {
        date: new Date().toISOString().split('T')[0],
        top_insights: [],
        competitive_signals: [],
        worth_reading: [],
        nothing_notable: true,
        article_count: 0,
        source_count: 0
      };
      const emailResult = await sendDigestEmail(emptyDigest);
      digestState.emailStatus = emailResult.status;
      digestState.lastDigestRun = new Date().toISOString();
      console.log(`[Signal] No articles found. Email: ${emailResult.status}`);
      return;
    }

    // 4. Generate insights via Claude
    const digest = await generateInsights(articles);

    // 4b. Enrich digest items with article IDs for reader link routing
    const articlesByUrl = new Map(articles.map(a => [a.link, a]));

    for (const insight of (digest.top_insights || [])) {
      const match = articlesByUrl.get(insight.url);
      if (match) {
        insight.article_id = match.id;
        insight.has_full_content = match.hasFullContent || false;
      }
    }
    for (const item of (digest.worth_reading || [])) {
      const match = articlesByUrl.get(item.url);
      if (match) {
        item.article_id = match.id;
        item.has_full_content = match.hasFullContent || false;
      }
    }

    // 5. Friday check → weekly summary
    let weeklyBullets = null;
    const today = new Date();
    if (today.getDay() === 5) { // Friday
      console.log('[Signal] Friday detected — generating weekly summary');
      const recentDigests = await readRecentDigests(5);
      weeklyBullets = await generateWeeklySummary(recentDigests);
    }

    // 6. Send email
    const emailResult = await sendDigestEmail(digest, weeklyBullets);
    digestState.emailStatus = emailResult.status;

    // 7. Archive to JSONL (always, even if email fails)
    await appendDigest(digest);

    // 8. Update state
    digestState.lastDigestRun = new Date().toISOString();
    digestState.lastError = null;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Signal] Complete in ${elapsed}s — ${articles.length} articles, ${digest.top_insights?.length || 0} insights, email: ${emailResult.status}`);

  } catch (error) {
    digestState.lastError = error.message;
    console.error('[Signal] Pipeline error:', error.message);
  }
}

/**
 * Initialize cron jobs and optional startup run
 */
export function initScheduler() {
  // Daily digest at 6:30 AM ET
  cron.schedule('30 6 * * *', () => {
    console.log('\n[Scheduler] Running daily digest (6:30 AM ET)...');
    runDailyDigest();
  }, {
    timezone: 'America/New_York'
  });

  // Weekly cleanup on Sunday midnight ET
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

  // Calculate next scheduled run for state
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(6, 30, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  digestState.nextScheduledRun = nextRun.toISOString();

  console.log('[Scheduler] Initialized');
  console.log('  - Daily digest: 6:30 AM ET');
  console.log('  - Weekly cleanup: Sunday 12:00 AM ET');

  // Optional startup run
  if (process.env.RUN_ON_STARTUP === 'true') {
    console.log('[Scheduler] RUN_ON_STARTUP=true, running digest now...');
    runDailyDigest();
  }
}
