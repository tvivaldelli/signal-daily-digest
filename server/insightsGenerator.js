import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Generate themed insights from a collection of articles
 * @param {Array} articles - Array of article objects with title, summary, link, source
 * @returns {Promise<Object>} - Structured insights organized by theme
 */
export async function generateInsights(articles) {
  try {
    // Handle empty or small article sets
    if (!articles || articles.length === 0) {
      return {
        success: false,
        message: 'No articles to analyze',
        themes: []
      };
    }

    // Check if API key is set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Claude API key not configured, returning fallback insights');
      return getFallbackInsights(articles);
    }

    // Prepare article data for Claude (limit to avoid token limits)
    const articlesToAnalyze = articles.slice(0, 50);
    const articleSummaries = articlesToAnalyze.map((article, index) => ({
      id: index,
      title: article.title,
      summary: article.summary || article.originalContent?.substring(0, 200) || '',
      source: article.source,
      link: article.link,
      pubDate: article.pubDate
    }));

    const prompt = `You are a strategic analyst for a Product Manager at Freedom Mortgage who is responsible for the digital mortgage experience. Analyze these articles to identify the most important strategic themes and actionable intelligence.

Articles:
${JSON.stringify(articleSummaries, null, 2)}

ANALYSIS REQUIREMENTS:

1. **Top Strategic Actions** (4-6 highest-impact actions):
   - Focus on competitive differentiation and measurable business impact
   - Each action must include: specific implementation, expected outcome, and priority level
   - Categories: Product Innovation | Competitive Intelligence | Customer Experience | Technology & AI
   - Be specific about HOW to implement, not just WHAT to do

2. **Strategic Themes** (3-4 ONLY - Quality over quantity):
   - Identify only the MOST IMPORTANT themes with significant strategic implications
   - Skip minor topics - focus on what truly matters for competitive advantage
   - For each theme provide DEEP ANALYSIS:
     * What's happening: Specific trends, data points, statistics from articles
     * Why it matters: Strategic implications, competitive context, market impact
     * What to do: Concrete recommendations with expected business outcomes
     * Supporting evidence: Article IDs and specific quotes/data

ANALYTICAL DEPTH REQUIREMENTS:
- Every insight must answer "So what?" - explain strategic significance
- Include specific numbers, percentages, quotes, or data points from articles
- Identify cause-and-effect relationships and trends
- Compare/contrast different approaches or perspectives in the articles
- Highlight competitive threats and opportunities
- Focus on what gives Freedom Mortgage an edge in digital experience

JSON STRUCTURE:
{
  "tldr": [
    "Concise bullet point 1 (1-2 sentences max, direct statement, no article citations)",
    "Concise bullet point 2 (1-2 sentences max, direct statement, no article citations)",
    "Concise bullet point 3 (1-2 sentences max, direct statement, no article citations)"
  ],
  "recommendedActions": [
    {
      "action": "Specific, measurable action with implementation details",
      "rationale": "Why this creates competitive advantage (with data/evidence)",
      "category": "Product Innovation" | "Competitive Intelligence" | "Customer Experience" | "Technology & AI",
      "priority": "High" | "Medium",
      "expectedImpact": "Specific business outcome (e.g., reduce drop-off by X%, increase conversion)"
    }
  ],
  "themes": [
    {
      "name": "Strategic theme name (concise)",
      "icon": "📊" | "💻" | "📜" | "🏠" | "🎯" | "⚡" | "🔍" | "💡",
      "insights": [
        {
          "text": "ANALYTICAL insight: What's happening + Why it matters + Strategic implications. Include specific data points, statistics, quotes. 4-6 sentences with depth.",
          "articleIds": [relevant article IDs]
        }
      ],
      "actions": [
        {
          "action": "Specific action with clear implementation path",
          "impact": "Measurable business impact on digital mortgage experience"
        }
      ]
    }
  ]
}

Focus on QUALITY over COVERAGE. It's better to have 3 deeply analyzed themes than 7 superficial ones. Think like a strategic consultant - identify patterns, implications, and opportunities that a busy PM would miss by just reading headlines.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000, // Increased for more detailed insights
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extract and parse Claude's response
    const responseText = message.content[0].text.trim();

    // Try to extract JSON from the response
    let insightsData;
    try {
      // Look for JSON in code blocks or raw text
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
                        responseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
      insightsData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Error parsing Claude response:', parseError);
      return getFallbackInsights(articles);
    }

    // Map article IDs back to actual articles
    const themesWithArticles = insightsData.themes.map(theme => ({
      ...theme,
      insights: theme.insights.map(insight => ({
        text: insight.text,
        articles: insight.articleIds
          .map(id => articleSummaries[id])
          .filter(a => a) // Remove undefined entries
      }))
    }));

    // Ensure every source is represented (post-processing)
    const finalThemes = ensureSourceCoverage(themesWithArticles, articleSummaries);

    console.log(`[Insights] Generated ${finalThemes.length} themes from ${articles.length} articles`);
    console.log(`[Insights] TL;DR bullets: ${insightsData.tldr?.length || 0}`);
    console.log(`[Insights] Recommended actions: ${insightsData.recommendedActions?.length || 0}`);

    // Debug: Log if tldr is missing
    if (!insightsData.tldr || insightsData.tldr.length === 0) {
      console.log('[Insights] WARNING: No TL;DR generated by Claude!');
      console.log('[Insights] Raw response keys:', Object.keys(insightsData));
    }

    return {
      success: true,
      tldr: insightsData.tldr || [], // Include TL;DR bullets
      recommendedActions: insightsData.recommendedActions || [],
      themes: finalThemes,
      articleCount: articles.length,
      generatedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error generating insights:', error.message);
    return getFallbackInsights(articles);
  }
}

/**
 * Ensure every source is represented in the insights (OPTIONAL)
 * Only add if there are significant missing sources (more than 30% uncovered)
 */
function ensureSourceCoverage(themes, articleSummaries) {
  // Get all unique sources from articles
  const allSources = [...new Set(articleSummaries.map(a => a.source))];

  // Find which sources are already represented in insights
  const representedSources = new Set();
  themes.forEach(theme => {
    theme.insights.forEach(insight => {
      insight.articles.forEach(article => {
        if (article && article.source) {
          representedSources.add(article.source);
        }
      });
    });
  });

  // Find missing sources
  const missingSources = allSources.filter(source => !representedSources.has(source));

  // Only add commentary section if more than 30% of sources are missing
  const coveragePercent = (representedSources.size / allSources.length) * 100;

  if (missingSources.length === 0 || coveragePercent >= 70) {
    console.log(`[Insights] Source coverage: ${Math.round(coveragePercent)}% - skipping commentary section`);
    return themes; // Good coverage, no need for filler
  }

  console.log(`[Insights] Low coverage (${Math.round(coveragePercent)}%) - adding ${missingSources.length} missing sources`);

  // Only create commentary for truly important missing sources
  // Skip generic roundup sources
  const importantMissingSources = missingSources.filter(source =>
    !source.toLowerCase().includes('newsletter') &&
    !source.toLowerCase().includes('podcast') &&
    missingSources.length <= 3 // Only if very few sources missing
  );

  if (importantMissingSources.length === 0) {
    return themes;
  }

  // Create minimal coverage theme
  const commentaryTheme = {
    name: 'Additional Insights',
    icon: '💡',
    insights: importantMissingSources.map(source => {
      const sourceArticles = articleSummaries.filter(a => a.source === source);
      return {
        text: `${source}: ${sourceArticles.length} article${sourceArticles.length > 1 ? 's' : ''} on industry developments`,
        articles: sourceArticles.slice(0, 3)
      };
    })
  };

  themes.push(commentaryTheme);
  return themes;
}

/**
 * Generate basic fallback insights when Claude API is unavailable
 */
function getFallbackInsights(articles) {
  const themes = [];

  // Group articles by source as a simple fallback
  const sourceGroups = {};
  articles.forEach(article => {
    if (!sourceGroups[article.source]) {
      sourceGroups[article.source] = [];
    }
    sourceGroups[article.source].push({
      id: article.link,
      title: article.title,
      summary: article.summary,
      source: article.source,
      link: article.link,
      pubDate: article.pubDate
    });
  });

  // Create a theme for each source
  Object.entries(sourceGroups).forEach(([source, sourceArticles]) => {
    themes.push({
      name: `${source} Updates`,
      icon: '📰',
      insights: [{
        text: `${sourceArticles.length} recent article${sourceArticles.length > 1 ? 's' : ''} from ${source}`,
        articles: sourceArticles.slice(0, 5) // Limit to 5 articles per source
      }]
    });
  });

  return {
    success: true,
    themes,
    articleCount: articles.length,
    generatedAt: new Date().toISOString(),
    fallback: true
  };
}
