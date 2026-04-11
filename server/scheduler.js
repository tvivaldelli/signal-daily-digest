import cron from 'node-cron';
import { fetchAllFeeds } from './rssFetcher.js';
import { getArticles, cleanOldArticles, markArticleFeatured, getRecentlyFeaturedUrls } from './db.js';
import { generateInsights, generateWeeklySummary, SLOW_DAY_THRESHOLD } from './insightsGenerator.js';
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
 * @param {Object} options
 * @param {boolean} options.dryRun - Skip Claude, send, write-back; print exclusion report
 * @param {boolean} options.dryRunWithClaude - Like dryRun but runs the real Claude call
 */
export async function runDailyDigest(options = {}) {
  const { dryRun = false, dryRunWithClaude = false } = options;
  const isDryRun = dryRun || dryRunWithClaude;
  const startTime = Date.now();
  const modeLabel = dryRunWithClaude ? ' (DRY RUN + CLAUDE)' : dryRun ? ' (DRY RUN)' : '';
  console.log(`\n[Signal] Starting daily digest pipeline at ${new Date().toISOString()}${modeLabel}`);

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

    // 4. Generate insights (or print exclusion report in cheap dry-run)
    let digest;
    if (dryRun && !dryRunWithClaude) {
      // Cheap dry-run: exclusion report without Claude API call
      const excludedInsights = getRecentlyFeaturedUrls('top_insight', 7);
      const excludedSignals = getRecentlyFeaturedUrls('competitive_signal', 7);
      const excludedWR = getRecentlyFeaturedUrls('worth_reading', 30);

      const contentArticles = articles.filter(a => a.type !== 'youtube' || a.originalContent);
      const excludedSet = new Set(excludedInsights);
      const candidates = contentArticles.filter(a => !excludedSet.has(a.link));

      console.log('\n[DRY RUN] Exclusion report (Claude API skipped):');
      console.log(`  Total articles: ${articles.length}`);
      console.log(`  Content articles: ${contentArticles.length}`);
      console.log(`  Excluded top_insight URLs (7d): ${excludedInsights.length}`);
      console.log(`  Excluded competitive_signal URLs (7d): ${excludedSignals.length}`);
      console.log(`  Excluded worth_reading URLs (30d): ${excludedWR.length}`);
      console.log(`  Non-excluded candidates for top_insight: ${candidates.length}`);

      if (candidates.length < SLOW_DAY_THRESHOLD) {
        console.log(`  → SLOW DAY would trigger (threshold: ${SLOW_DAY_THRESHOLD})`);
      }

      if (candidates.length > 0) {
        console.log('\n  Candidate articles (not excluded from top_insight):');
        for (const a of candidates.slice(0, 20)) {
          console.log(`    - ${a.title} (${a.source})`);
          console.log(`      ${a.link}`);
        }
        if (candidates.length > 20) console.log(`    ... and ${candidates.length - 20} more`);
      }

      const sourceCount = new Set(articles.map(a => a.source)).size;
      digest = {
        date: new Date().toISOString().split('T')[0],
        top_insights: [],
        competitive_signals: [],
        worth_reading: [],
        nothing_notable: candidates.length < SLOW_DAY_THRESHOLD,
        slow_day: candidates.length < SLOW_DAY_THRESHOLD,
        article_count: articles.length,
        source_count: sourceCount
      };
    } else {
      digest = await generateInsights(articles);
    }

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

    // 6. Send email (or print in dry-run mode)
    let emailResult;
    if (isDryRun) {
      const date = new Date(digest.date || Date.now());
      const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const subject = digest.slow_day
        ? 'Signal \u2014 Slow Day'
        : weeklyBullets
          ? `Weekly Review + Signal \u2014 ${dateStr}`
          : `Signal \u2014 ${dateStr}`;

      console.log('\n[DRY RUN] Would send email:');
      console.log(`  To: ${process.env.DIGEST_EMAIL}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Insights: ${digest.top_insights?.length || 0}`);
      console.log(`  Signals: ${digest.competitive_signals?.length || 0}`);
      console.log(`  Worth reading: ${digest.worth_reading?.length || 0}`);
      if (digest.slow_day) console.log('  Body: Nothing material today. See you tomorrow.');
      emailResult = { status: 'dry_run' };
    } else {
      emailResult = await sendDigestEmail(digest, weeklyBullets);
    }
    digestState.emailStatus = emailResult.status;

    // 7. Write featured URLs to dedup table (only on successful send, never dry-run)
    if (emailResult.status === 'sent' && !digest.slow_day) {
      const writeBackItems = [
        ...(digest.top_insights || []).map(i => ({ url: i.url, title: i.headline, section: 'top_insight' })),
        ...(digest.competitive_signals || []).map(s => ({ url: s.url, title: s.signal, section: 'competitive_signal' })),
        ...(digest.worth_reading || []).map(w => ({ url: w.url, title: w.title, section: 'worth_reading' })),
      ].filter(item => item.url);

      for (const item of writeBackItems) {
        markArticleFeatured(item.url, item.title, item.section);
      }
      console.log(`[Signal] Wrote ${writeBackItems.length} URLs to featured_articles`);
    } else if (isDryRun && !digest.slow_day) {
      const wouldWrite = [
        ...(digest.top_insights || []).map(i => i.url),
        ...(digest.competitive_signals || []).map(s => s.url),
        ...(digest.worth_reading || []).map(w => w.url),
      ].filter(Boolean);
      if (wouldWrite.length > 0) {
        console.log(`\n[DRY RUN] Would write ${wouldWrite.length} URLs to featured_articles:`);
        for (const url of wouldWrite) console.log(`  - ${url}`);
      }
    }

    // 8. Archive to JSONL (always, even if email fails — but skip in dry-run)
    if (!isDryRun) {
      await appendDigest(digest);
    } else {
      console.log('\n[DRY RUN] Skipped JSONL archive write');
    }

    // 9. Update state
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
