import Anthropic from '@anthropic-ai/sdk';
import { getRecentlyFeaturedUrls } from './db.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const API_TIMEOUT_MS = 180000;

/** Minimum non-excluded candidate articles required to run the full pipeline */
export const SLOW_DAY_THRESHOLD = 2;

function createTimeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Claude API request timed out after ${ms / 1000} seconds`)), ms);
  });
}

/**
 * Generate a unified daily digest from all articles (no category split)
 * @param {Array} articles - All articles from the last 24 hours
 * @returns {Promise<Object>} Digest object matching the email template format
 */
export async function generateInsights(articles) {
  if (!articles || articles.length === 0) {
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      pm_craft: [],
      worth_reading: [],
      nothing_notable: true,
      article_count: 0,
      source_count: 0
    };
  }

  // Separate enriched YouTube videos (with descriptions) from title-only ones
  const enrichedYouTube = articles.filter(a => a.type === 'youtube' && a.originalContent);
  const titleOnlyYouTube = articles.filter(a => a.type === 'youtube' && !a.originalContent);
  const contentArticles = [...articles.filter(a => a.type !== 'youtube'), ...enrichedYouTube];

  const sourceCount = new Set(articles.map(a => a.source)).size;

  // --- Cross-digest dedup: filter excluded URLs out of candidates server-side ---
  // Union section windows so an article excluded from any section is hidden from Claude entirely.
  const excludedInsightUrls = getRecentlyFeaturedUrls('top_insight', 7);
  const excludedSignalUrls = getRecentlyFeaturedUrls('competitive_signal', 7);
  const excludedPmCraftUrls = getRecentlyFeaturedUrls('pm_craft', 14);
  const excludedWorthReadingUrls = getRecentlyFeaturedUrls('worth_reading', 30);
  const excludedSet = new Set([
    ...excludedInsightUrls,
    ...excludedSignalUrls,
    ...excludedPmCraftUrls,
    ...excludedWorthReadingUrls,
  ]);

  const preFilterContent = contentArticles.length;
  const preFilterYouTube = titleOnlyYouTube.length;
  const filteredContentArticles = contentArticles.filter(a => !excludedSet.has(a.link));
  const filteredTitleOnlyYouTube = titleOnlyYouTube.filter(a => !excludedSet.has(a.link));
  const excludedCount = (preFilterContent - filteredContentArticles.length) +
                        (preFilterYouTube - filteredTitleOnlyYouTube.length);
  console.log(`[Insights] URL filter excluded ${excludedCount} article(s); ${filteredContentArticles.length} content + ${filteredTitleOnlyYouTube.length} youtube candidate(s) remain`);

  if (filteredContentArticles.length < SLOW_DAY_THRESHOLD) {
    console.log(`[Insights] Slow day: only ${filteredContentArticles.length} non-excluded candidate(s) (threshold: ${SLOW_DAY_THRESHOLD})`);
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      pm_craft: [],
      worth_reading: [],
      nothing_notable: true,
      slow_day: true,
      article_count: articles.length,
      source_count: sourceCount
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Insights] No API key configured, returning nothing-notable');
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      pm_craft: [],
      worth_reading: [],
      nothing_notable: true,
      article_count: articles.length,
      source_count: sourceCount
    };
  }

  // Group content articles by category
  const grouped = {};
  for (const article of filteredContentArticles) {
    const cat = article.category || 'uncategorized';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      id: article.id,
      title: article.title,
      summary: article.originalContent?.substring(0, 2000) || article.summary || '',
      source: article.source,
      link: article.link,
      pubDate: article.pubDate,
      hasFullContent: article.hasFullContent || false
    });
  }

  let articleBlock = '';
  for (const [category, items] of Object.entries(grouped)) {
    articleBlock += `\n## ${category.toUpperCase()} (${items.length} articles)\n`;
    for (const item of items) {
      articleBlock += `- **${item.title}** (${item.source})\n  ${item.summary}\n  URL: ${item.link}\n`;
    }
  }

  if (filteredTitleOnlyYouTube.length > 0) {
    articleBlock += `\n## YOUTUBE VIDEOS (${filteredTitleOnlyYouTube.length} items — titles only, do NOT generate insights from video titles)\n`;
    for (const item of filteredTitleOnlyYouTube) {
      articleBlock += `- ${item.title} (${item.source}) — ${item.link}\n`;
    }
  }

  const prompt = `You curate a daily intelligence digest with two tracks: mortgage industry intelligence for a digital product team, and product management craft for the curator's professional development.

CONTEXT (for mortgage track only):
- The reader works on the digital mortgage experience: online applications, servicing portal, mobile app
- Current priorities: digital self-service, digital originations, mobile app engagement, AI-driven process automation
- Roadmap themes: servicing retention, loss mitigation automation, borrower communication
- Key competitors: Rocket Mortgage, United Wholesale Mortgage, loanDepot, PennyMac
- Fintech disruptors: Better, Blend, Figure, Beeline, Tomo, ICE Mortgage Technology

TODAY'S ARTICLES (${filteredContentArticles.length} content articles + ${filteredTitleOnlyYouTube.length} title-only videos from ${sourceCount} sources):
${articleBlock}

SECTION CRITERIA:

top_insights — Mortgage industry intelligence. Include if at least ONE:
1. Directly affects mortgage servicing or origination strategy
2. Signals a technology shift that could change mortgage origination or servicing
3. Represents a competitor move that requires attention or creates an opportunity
4. Provides actionable intelligence for a digital product roadmap
5. Highlights a product launch, UX change, or digital experience update from a competitor or fintech disruptor

pm_craft — Product management craft. Evaluate on PM merit alone, NOT mortgage relevance. Include if it offers:
1. A product management framework, practice, or mental model
2. A concrete case study of how a product team made a decision or shipped something
3. Insight on AI-assisted product work, workflows, or tooling
4. Leadership, hiring, or team-building wisdom relevant to a senior PM
5. A sharp essay on craft, judgment, or decision-making in product work

Do NOT contort mortgage articles into pm_craft. Do NOT contort PM articles into top_insights. If a PM article happens to have genuine mortgage relevance, it can go in top_insights — but never the reverse.

competitive_signals — Specific competitor moves with strategic implications. Empty array is fine.

worth_reading — Catch-all for articles that didn't make a top section but are worth 5 minutes. Mix of mortgage and PM is fine.

Skip: generic market commentary, rate predictions, political/regulatory speculation without specific impact, content behind a paywall with no useful summary.

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "date": "${new Date().toISOString().split('T')[0]}",
  "top_insights": [
    {
      "headline": "One-line insight headline",
      "explanation": "2-3 sentences: what happened and why it matters",
      "connection": "How this connects to digital mortgage priorities",
      "source": "Source name",
      "url": "Article URL"
    }
  ],
  "competitive_signals": [
    {
      "competitor": "Company name",
      "signal": "What they did",
      "implication": "What it means for mortgage product strategy",
      "url": "Article URL"
    }
  ],
  "pm_craft": [
    {
      "headline": "One-line headline capturing the idea",
      "explanation": "2-3 sentences on what the article argues or teaches",
      "why_it_matters": "Why this is worth a senior PM's attention — judged on the idea itself, not on mortgage relevance",
      "source": "Source name",
      "url": "Article URL"
    }
  ],
  "worth_reading": [
    {
      "title": "Article title",
      "reason": "Why it's worth 5 minutes",
      "url": "URL"
    }
  ],
  "nothing_notable": false,
  "article_count": ${articles.length},
  "source_count": ${sourceCount}
}

RULES:
- top_insights: Exactly 3 (or fewer if truly nothing qualifies). Quality over quantity.
- competitive_signals: 0-3. Only include if a specific competitor is mentioned. Empty array is fine.
- pm_craft: 0-3. Empty array is fine if no PM content meets the bar today. Do NOT lower the bar to fill the section.
- worth_reading: 3-5 links. Mix mortgage and PM as the day's content allows. YouTube videos can go here.
- If genuinely nothing is notable today, set nothing_notable: true and leave arrays empty.
- Never fabricate URLs — only use URLs from the articles provided.
- Do not generate insights from YouTube video titles alone.
Return ONLY the JSON object, no other text.`;

  const MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-5'];

  try {
    let message;
    let usedModel;
    for (const model of MODELS) {
      let succeeded = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const apiRequest = anthropic.messages.create({
            model,
            max_tokens: 8000,
            temperature: 0.25,
            messages: [{ role: 'user', content: prompt }]
          });

          message = await Promise.race([apiRequest, createTimeout(API_TIMEOUT_MS)]);
          usedModel = model;
          succeeded = true;
          break;
        } catch (apiError) {
          console.error(`[Insights] ${model} attempt ${attempt}/2 failed: ${apiError.message}`);
          if (attempt === 1) {
            console.log(`[Insights] Retrying ${model} in 15 seconds...`);
            await new Promise(r => setTimeout(r, 15000));
          }
        }
      }
      if (succeeded) break;
      if (model !== MODELS[MODELS.length - 1]) {
        console.log(`[Insights] ${model} unavailable, falling back to next model...`);
      }
    }

    if (!message) {
      throw new Error(`All models failed (tried: ${MODELS.join(', ')})`);
    }

    console.log(`[Insights] Using model: ${usedModel}`);

    const responseText = message.content[0].text.trim();

    // Parse JSON (handle possible code fences)
    let digest;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
                        responseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
      digest = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('[Insights] Error parsing Claude response:', parseError.message);
      console.error('[Insights] Raw response (first 500 chars):', responseText.substring(0, 500));
      return {
        date: new Date().toISOString().split('T')[0],
        top_insights: [],
        competitive_signals: [],
        pm_craft: [],
        worth_reading: [],
        nothing_notable: true,
        error: `Failed to parse Claude response: ${parseError.message}`,
        article_count: articles.length,
        source_count: sourceCount
      };
    }

    // Ensure required fields
    digest.date = digest.date || new Date().toISOString().split('T')[0];
    digest.article_count = articles.length;
    digest.source_count = sourceCount;
    digest.top_insights = digest.top_insights || [];
    digest.competitive_signals = digest.competitive_signals || [];
    digest.pm_craft = digest.pm_craft || [];
    digest.worth_reading = digest.worth_reading || [];
    digest.nothing_notable = digest.nothing_notable || false;

    // Deduplicate across sections (priority: insights > signals > worth_reading)
    // Match on URLs when available, plus source+keyword overlap for items without URLs
    const usedUrls = new Set();
    const usedFingerprints = new Set();

    function fingerprint(text) {
      if (!text) return '';
      return text.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function overlaps(a, b) {
      const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
      const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
      if (wordsA.size === 0 || wordsB.size === 0) return false;
      let shared = 0;
      for (const w of wordsA) { if (wordsB.has(w)) shared++; }
      return shared >= 2 && shared / Math.min(wordsA.size, wordsB.size) >= 0.4;
    }

    // Collect fingerprints from top_insights and pm_craft (highest priority sections)
    for (const item of digest.top_insights) {
      if (item.url) usedUrls.add(item.url);
      const fp = fingerprint(item.headline || item.explanation || '');
      if (fp) usedFingerprints.add(fp);
    }
    for (const item of digest.pm_craft) {
      if (item.url) usedUrls.add(item.url);
      const fp = fingerprint(item.headline || item.explanation || '');
      if (fp) usedFingerprints.add(fp);
    }

    function isDuplicate(url, text) {
      if (url && usedUrls.has(url)) return true;
      const fp = fingerprint(text);
      if (!fp) return false;
      for (const used of usedFingerprints) {
        if (overlaps(fp, used)) return true;
      }
      return false;
    }

    function markUsed(url, text) {
      if (url) usedUrls.add(url);
      const fp = fingerprint(text);
      if (fp) usedFingerprints.add(fp);
    }

    const prevSignals = digest.competitive_signals.length;
    digest.competitive_signals = digest.competitive_signals.filter(item => {
      if (isDuplicate(item.url, item.signal || item.competitor)) return false;
      markUsed(item.url, item.signal || item.competitor);
      return true;
    });

    const prevLinks = digest.worth_reading.length;
    digest.worth_reading = digest.worth_reading.filter(item => {
      if (isDuplicate(item.url, item.title)) return false;
      return true;
    });

    const removed = (prevSignals - digest.competitive_signals.length) + (prevLinks - digest.worth_reading.length);
    if (removed > 0) {
      console.log(`[Insights] Dedup removed ${removed} duplicate(s) from lower-priority sections`);
    }

    console.log(`[Insights] Generated: ${digest.top_insights.length} insights, ${digest.pm_craft.length} pm_craft, ${digest.competitive_signals.length} signals, ${digest.worth_reading.length} links`);
    return digest;

  } catch (error) {
    console.error(`[Insights] Error generating insights: ${error.message}`);
    console.error(`[Insights] Error type: ${error.constructor.name}, status: ${error.status || 'N/A'}`);
    console.error(`[Insights] Articles passed: ${articles.length}, prompt length: ${prompt.length} chars`);
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      pm_craft: [],
      worth_reading: [],
      nothing_notable: true,
      error: `Claude API failed after 2 attempts: ${error.message}`,
      article_count: articles.length,
      source_count: sourceCount
    };
  }
}

/**
 * Generate a weekly summary from the last 5 daily digests
 * @param {Array} recentDigests - Array of recent digest objects (newest first)
 * @returns {Promise<Array<string>>} Array of 3-5 bullet summary strings
 */
export async function generateWeeklySummary(recentDigests) {
  if (!recentDigests || recentDigests.length === 0) return [];

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Insights] No API key, skipping weekly summary');
    return [];
  }

  const digestSummary = recentDigests.map(d => {
    const insights = (d.top_insights || []).map(i => `- ${i.headline}: ${i.explanation}`).join('\n');
    const signals = (d.competitive_signals || []).map(s => `- ${s.competitor}: ${s.signal}`).join('\n');
    const pmCraft = (d.pm_craft || []).map(p => `- ${p.headline}: ${p.explanation}`).join('\n');
    return `### ${d.date}\nInsights:\n${insights}\nSignals:\n${signals}\nPM Craft:\n${pmCraft}`;
  }).join('\n\n');

  const prompt = `You are a weekly intelligence summarizer for a digital product leader in financial services.

Here are the daily digests from this week:

${digestSummary}

Write 3-5 bullet points summarizing the most important patterns, trends, and action items from the entire week. Focus on:
1. Recurring themes across multiple days
2. The single most important competitive development
3. What should be discussed in the next product team meeting
4. If PM Craft items show recurring themes (e.g., AI tooling patterns, decision-making frameworks), surface those as well

Return ONLY a JSON array of strings (each string is one bullet point). No other text.
Example: ["Bullet one here", "Bullet two here", "Bullet three here"]`;

  try {
    const apiRequest = anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.25,
      messages: [{ role: 'user', content: prompt }]
    });

    const message = await Promise.race([apiRequest, createTimeout(60000)]);
    const responseText = message.content[0].text.trim();

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    const bullets = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    console.log(`[Insights] Weekly summary: ${bullets.length} bullets`);
    return bullets;
  } catch (error) {
    console.error('[Insights] Error generating weekly summary:', error.message);
    return [];
  }
}
