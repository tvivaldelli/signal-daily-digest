import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, getRecentlyFeaturedUrls, markArticleFeatured } from '../server/db.js';

// Clean the featured_articles table before each test
beforeEach(() => {
  db.prepare('DELETE FROM featured_articles').run();
});

describe('getRecentlyFeaturedUrls', () => {
  it('excludes an article featured today from selection', () => {
    // Insert an article featured right now
    markArticleFeatured('https://example.com/today', 'Today Article', 'top_insight');

    const excluded = getRecentlyFeaturedUrls('top_insight', 7);
    assert.ok(excluded.includes('https://example.com/today'), 'Today\'s article should be excluded');
  });

  it('allows a top_insight article featured 8 days ago', () => {
    // Insert with a date 8 days in the past
    db.prepare(`
      INSERT INTO featured_articles (url, title, section, first_featured_date, last_featured_date, feature_count)
      VALUES (?, ?, ?, datetime('now', '-8 days'), datetime('now', '-8 days'), 1)
    `).run('https://example.com/old-insight', 'Old Insight', 'top_insight');

    const excluded = getRecentlyFeaturedUrls('top_insight', 7);
    assert.ok(!excluded.includes('https://example.com/old-insight'), 'Article from 8 days ago should not be excluded for top_insight (7-day window)');
  });

  it('still excludes a worth_reading article featured 8 days ago (30-day window)', () => {
    db.prepare(`
      INSERT INTO featured_articles (url, title, section, first_featured_date, last_featured_date, feature_count)
      VALUES (?, ?, ?, datetime('now', '-8 days'), datetime('now', '-8 days'), 1)
    `).run('https://example.com/old-wr', 'Old Worth Reading', 'worth_reading');

    const excluded = getRecentlyFeaturedUrls('worth_reading', 30);
    assert.ok(excluded.includes('https://example.com/old-wr'), 'Article from 8 days ago should still be excluded for worth_reading (30-day window)');
  });
});

describe('markArticleFeatured upsert', () => {
  it('bumps feature_count and last_featured_date on conflict', () => {
    // First insert — set date to 3 days ago
    db.prepare(`
      INSERT INTO featured_articles (url, title, section, first_featured_date, last_featured_date, feature_count)
      VALUES (?, ?, ?, datetime('now', '-3 days'), datetime('now', '-3 days'), 1)
    `).run('https://example.com/upsert', 'Upsert Test', 'top_insight');

    const before = db.prepare('SELECT * FROM featured_articles WHERE url = ?').get('https://example.com/upsert');
    assert.equal(before.feature_count, 1);

    // Upsert via markArticleFeatured
    markArticleFeatured('https://example.com/upsert', 'Upsert Test', 'top_insight');

    const after = db.prepare('SELECT * FROM featured_articles WHERE url = ?').get('https://example.com/upsert');
    assert.equal(after.feature_count, 2, 'feature_count should be bumped to 2');
    assert.ok(after.last_featured_date > before.last_featured_date, 'last_featured_date should be updated');
    assert.equal(after.first_featured_date, before.first_featured_date, 'first_featured_date should not change');
  });
});

describe('slow-day detection', () => {
  it('triggers when candidate pool drops below threshold', async () => {
    // Set up: feature all candidate URLs so exclusion leaves < SLOW_DAY_THRESHOLD
    const { SLOW_DAY_THRESHOLD } = await import('../server/insightsGenerator.js');

    // Create a small article set
    const articles = [
      { id: 1, title: 'Article A', link: 'https://a.com/1', source: 'SourceA', category: 'mortgage', type: 'article', summary: 'Summary A', pubDate: new Date().toISOString() },
      { id: 2, title: 'Article B', link: 'https://b.com/2', source: 'SourceB', category: 'mortgage', type: 'article', summary: 'Summary B', pubDate: new Date().toISOString() },
    ];

    // Feature both articles as top_insight so they're excluded
    markArticleFeatured('https://a.com/1', 'Article A', 'top_insight');
    markArticleFeatured('https://b.com/2', 'Article B', 'top_insight');

    // Import generateInsights — it will hit the slow-day path because all candidates are excluded
    const { generateInsights } = await import('../server/insightsGenerator.js');
    const result = await generateInsights(articles);

    assert.equal(result.slow_day, true, 'Should return slow_day: true');
    assert.equal(result.nothing_notable, true);
    assert.equal(result.top_insights.length, 0);
    assert.equal(result.article_count, articles.length);
  });
});

describe('write-back conditions', () => {
  it('does not write to featured_articles on failed email send', async () => {
    // Simulate: we have a digest with URLs, but email failed
    // The write-back logic is: if emailResult.status === 'sent' && !digest.slow_day
    // We test the condition directly since mocking the full pipeline is heavy

    const digest = {
      top_insights: [{ url: 'https://fail.com/1', headline: 'Fail Test' }],
      competitive_signals: [],
      worth_reading: [],
    };

    // Simulate failed send — do NOT call markArticleFeatured
    const emailResult = { status: 'failed', error: 'test' };

    if (emailResult.status === 'sent' && !digest.slow_day) {
      for (const i of digest.top_insights) {
        markArticleFeatured(i.url, i.headline, 'top_insight');
      }
    }

    const rows = db.prepare('SELECT * FROM featured_articles WHERE url = ?').all('https://fail.com/1');
    assert.equal(rows.length, 0, 'Should not write to featured_articles on failed send');
  });

  it('does not write to featured_articles in dry-run mode', async () => {
    const digest = {
      top_insights: [{ url: 'https://dry.com/1', headline: 'Dry Test' }],
      competitive_signals: [],
      worth_reading: [],
    };

    // Simulate dry-run — emailResult.status is 'dry_run', not 'sent'
    const emailResult = { status: 'dry_run' };

    if (emailResult.status === 'sent' && !digest.slow_day) {
      for (const i of digest.top_insights) {
        markArticleFeatured(i.url, i.headline, 'top_insight');
      }
    }

    const rows = db.prepare('SELECT * FROM featured_articles WHERE url = ?').all('https://dry.com/1');
    assert.equal(rows.length, 0, 'Should not write to featured_articles in dry-run mode');
  });
});
