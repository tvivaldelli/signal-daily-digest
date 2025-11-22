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

    const prompt = `You are analyzing mortgage and real estate industry articles for a Product Manager at the company who is responsible for the digital experience. Your analysis should focus on actionable insights and strategic recommendations.

Articles:
${JSON.stringify(articleSummaries, null, 2)}

Please provide a comprehensive analysis with:

1. **Recommended Actions** (5-7 high-priority actions for the company's digital experience):
   - Focus on: product features, competitive intelligence, customer experience insights, technology & innovation
   - Each action should be specific, strategic, and tied to market trends/opportunities
   - Prioritize actions that can differentiate the company's digital experience

2. **Thematic Insights** (5-7 major themes):
   - Common themes: Market Trends, Technology & Innovation, Policy & Regulation, Lending Practices, Housing Affordability, Industry Commentary/Roundups, Customer Experience, Competitive Landscape
   - IMPORTANT: Ensure each source represented in the articles appears in at least one insight for balanced coverage
   - For each theme provide:
     * A clear theme name with relevant icon
     * 2-4 key insights (each 3-5 sentences with specific details, data points, context)
     * 2-3 specific recommended actions related to this theme for the PM
     * Article IDs that support each insight

Return your response as a JSON object with this structure:
{
  "recommendedActions": [
    {
      "action": "Clear, specific action statement",
      "rationale": "Why this matters for the company's digital experience (1-2 sentences)",
      "category": "Product Features" or "Competitive Intelligence" or "Customer Experience" or "Technology & Innovation"
    }
  ],
  "themes": [
    {
      "name": "Theme Name",
      "icon": "📊" or "💻" or "📜" or "🏠" or "💬" or "🎯" or "⚡" etc,
      "insights": [
        {
          "text": "Key insight text with specific details and context...",
          "articleIds": [0, 3, 7]
        }
      ],
      "actions": [
        {
          "action": "Specific action related to this theme",
          "impact": "Expected impact on digital experience"
        }
      ]
    }
  ]
}

Provide detailed analysis including specific metrics, trends, implications, and actionable takeaways. Include relevant context such as statistics, quotes, or specific developments. Focus on what would be most valuable for a product manager building a competitive digital mortgage experience. Think strategically about market opportunities, user needs, and competitive differentiation.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 5000,
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

    return {
      success: true,
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
 * Ensure every source is represented in the insights
 * Post-processes AI-generated themes to add missing sources
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

  if (missingSources.length === 0) {
    return themes; // All sources already represented
  }

  console.log(`[Insights] Adding coverage for ${missingSources.length} missing source(s): ${missingSources.join(', ')}`);

  // Find or create an "Industry Commentary" theme for missing sources
  let commentaryTheme = themes.find(t =>
    t.name.toLowerCase().includes('commentary') ||
    t.name.toLowerCase().includes('roundup') ||
    t.name.toLowerCase().includes('industry news')
  );

  if (!commentaryTheme) {
    // Create new theme for missing sources
    commentaryTheme = {
      name: 'Industry Commentary & Updates',
      icon: '💬',
      insights: []
    };
    themes.push(commentaryTheme);
  }

  // Add insights for each missing source
  missingSources.forEach(source => {
    const sourceArticles = articleSummaries.filter(a => a.source === source);
    if (sourceArticles.length > 0) {
      // Create an insight for this source
      const articleTitles = sourceArticles.slice(0, 3).map(a => a.title).join('; ');
      const insightText = sourceArticles.length === 1
        ? `${source} provides commentary: ${sourceArticles[0].title}`
        : `${source} covers ${sourceArticles.length} topics including ${articleTitles.substring(0, 150)}${articleTitles.length > 150 ? '...' : ''}`;

      commentaryTheme.insights.push({
        text: insightText,
        articles: sourceArticles.slice(0, 5) // Limit to 5 articles
      });
    }
  });

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
