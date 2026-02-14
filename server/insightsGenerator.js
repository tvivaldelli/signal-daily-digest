import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const API_TIMEOUT_MS = 180000;

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
      worth_reading: [],
      nothing_notable: true,
      article_count: 0,
      source_count: 0
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Insights] No API key configured, returning nothing-notable');
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      worth_reading: [],
      nothing_notable: true,
      article_count: articles.length,
      source_count: new Set(articles.map(a => a.source)).size
    };
  }

  // Separate content articles from YouTube video titles
  const contentArticles = articles.filter(a => a.type !== 'youtube');
  const youtubeArticles = articles.filter(a => a.type === 'youtube');

  // Group content articles by category
  const grouped = {};
  for (const article of contentArticles) {
    const cat = article.category || 'uncategorized';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      title: article.title,
      summary: article.summary || article.originalContent?.substring(0, 200) || '',
      source: article.source,
      link: article.link,
      pubDate: article.pubDate
    });
  }

  const sourceCount = new Set(articles.map(a => a.source)).size;

  let articleBlock = '';
  for (const [category, items] of Object.entries(grouped)) {
    articleBlock += `\n## ${category.toUpperCase()} (${items.length} articles)\n`;
    for (const item of items) {
      articleBlock += `- **${item.title}** (${item.source})\n  ${item.summary}\n  URL: ${item.link}\n`;
    }
  }

  if (youtubeArticles.length > 0) {
    articleBlock += `\n## YOUTUBE VIDEOS (${youtubeArticles.length} items — titles only, do NOT generate insights from video titles)\n`;
    for (const item of youtubeArticles) {
      articleBlock += `- ${item.title} (${item.source}) — ${item.link}\n`;
    }
  }

  const prompt = `You are the daily intelligence analyst for a Product Manager at Freedom Mortgage who owns the digital mortgage experience (online applications, servicing portal, mobile app).

CONTEXT:
- Freedom Mortgage is a top-5 US mortgage servicer
- Current priorities: digital self-service, AI-assisted underwriting, mobile app engagement
- Roadmap themes: servicing retention, loss mitigation automation, borrower communication
- Key competitors: Rocket Mortgage (acquired Mr. Cooper), United Wholesale Mortgage, loanDepot, PennyMac
- Fintech disruptors: Better, Blend, Figure, Beeline, Tomo, ICE Mortgage Technology

TODAY'S ARTICLES (${contentArticles.length} content articles + ${youtubeArticles.length} videos from ${sourceCount} sources):
${articleBlock}

FILTERING CRITERIA — Only include in top_insights or competitive_signals if at least ONE:
1. Directly affects Freedom Mortgage's business or competitive position
2. Signals a technology shift that could change mortgage origination or servicing
3. Represents a competitor move that requires a response or creates an opportunity
4. Provides actionable intelligence for the product roadmap

For worth_reading, also include strong product management content (frameworks, practices, case studies, AI/workflow thinking) even if it has no direct mortgage connection — it informs how the PM works, not just what they work on.

Skip: generic market commentary, rate predictions, political/regulatory speculation without specific impact, content that's behind a paywall with no useful summary.

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "date": "${new Date().toISOString().split('T')[0]}",
  "top_insights": [
    {
      "headline": "One-line insight headline",
      "explanation": "2-3 sentences: what happened and why it matters",
      "connection": "How this connects to Freedom's priorities or roadmap",
      "source": "Source name",
      "url": "Article URL"
    }
  ],
  "competitive_signals": [
    {
      "competitor": "Company name",
      "signal": "What they did",
      "implication": "What it means for Freedom"
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
- worth_reading: 3-5 links. Aim for a mix: 2-3 product management articles (from SVPG, Teresa Torres, Lenny's Newsletter, Ethan Mollick, or similar PM/AI sources) plus any standout mortgage or competitive articles. PM content is always valuable here even without a mortgage connection. YouTube videos can go here too.
- If genuinely nothing is notable today, set nothing_notable: true and leave arrays empty.
- Never fabricate URLs — only use URLs from the articles provided.
- Do not generate insights from YouTube video titles alone.

Return ONLY the JSON object, no other text.`;

  try {
    const apiRequest = anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      temperature: 0.25,
      messages: [{ role: 'user', content: prompt }]
    });

    const message = await Promise.race([apiRequest, createTimeout(API_TIMEOUT_MS)]);
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
      return {
        date: new Date().toISOString().split('T')[0],
        top_insights: [],
        competitive_signals: [],
        worth_reading: [],
        nothing_notable: true,
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

    // Collect fingerprints from top_insights
    for (const item of digest.top_insights) {
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

    console.log(`[Insights] Generated: ${digest.top_insights.length} insights, ${digest.competitive_signals.length} signals, ${digest.worth_reading.length} links`);
    return digest;

  } catch (error) {
    console.error(`[Insights] Error generating insights: ${error.message}`);
    console.error(`[Insights] Error type: ${error.constructor.name}, status: ${error.status || 'N/A'}`);
    console.error(`[Insights] Articles passed: ${articles.length}, prompt length: ${prompt.length} chars`);
    return {
      date: new Date().toISOString().split('T')[0],
      top_insights: [],
      competitive_signals: [],
      worth_reading: [],
      nothing_notable: true,
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
    return `### ${d.date}\nInsights:\n${insights}\nSignals:\n${signals}`;
  }).join('\n\n');

  const prompt = `You are a weekly intelligence summarizer for a mortgage industry Product Manager.

Here are the daily digests from this week:

${digestSummary}

Write 3-5 bullet points summarizing the most important patterns, trends, and action items from the entire week. Focus on:
1. Recurring themes across multiple days
2. The single most important competitive development
3. What should be discussed in the next product team meeting

Return ONLY a JSON array of strings (each string is one bullet point). No other text.
Example: ["Bullet one here", "Bullet two here", "Bullet three here"]`;

  try {
    const apiRequest = anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
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
