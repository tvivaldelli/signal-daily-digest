import Database from '@replit/database';

const db = new Database();

/**
 * Store an article in the database
 * @param {Object} article - Article object with title, summary, link, source, pubDate
 */
export async function saveArticle(article) {
  const articleId = `article:${article.link}`;

  // Clean and limit the data to ensure it can be stored
  const articleData = {
    title: article.title || '',
    link: article.link || '',
    pubDate: article.pubDate || new Date().toISOString(),
    source: article.source || '',
    summary: (article.summary || '').substring(0, 500),  // Limit summary to 500 chars
    originalContent: (article.originalContent || '').substring(0, 500),  // Limit content to 500 chars
    savedAt: new Date().toISOString()
  };

  try {
    await db.set(articleId, JSON.stringify(articleData));

    // Verify the save
    const verify = await db.get(articleId);
    if (!verify) {
      console.error(`[DB] ERROR: Failed to save article ${articleId}`);
    }
  } catch (error) {
    console.error(`[DB] Exception saving article ${articleId}:`, error.message);
  }

  // Also maintain a list of article IDs for efficient retrieval
  const articleIds = await getArticleIds();
  if (!articleIds.includes(article.link)) {
    articleIds.push(article.link);
    await db.set('articleIds', articleIds);
  }

  return articleData;
}

/**
 * Get list of all article IDs
 */
async function getArticleIds() {
  const ids = await db.get('articleIds');
  return ids || [];
}

/**
 * Retrieve all articles with optional filters
 * @param {Object} filters - { source, startDate, endDate, keyword }
 */
export async function getArticles(filters = {}) {
  const articleIds = await getArticleIds();
  const articles = [];

  for (const link of articleIds) {
    const articleJson = await db.get(`article:${link}`);
    if (articleJson) {
      try {
        const article = JSON.parse(articleJson);
        articles.push(article);
      } catch (error) {
        console.error(`[DB] Error parsing article ${link}:`, error.message);
      }
    }
  }

  let filtered = articles;

  // Apply filters
  if (filters.source) {
    filtered = filtered.filter(a => a.source === filters.source);
  }

  if (filters.startDate) {
    const startDate = new Date(filters.startDate);
    startDate.setHours(0, 0, 0, 0);
    filtered = filtered.filter(a => new Date(a.pubDate) >= startDate);
  }

  if (filters.endDate) {
    const endDate = new Date(filters.endDate);
    endDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(a => new Date(a.pubDate) <= endDate);
  }

  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    filtered = filtered.filter(a =>
      a.title.toLowerCase().includes(keyword) ||
      (a.summary && a.summary.toLowerCase().includes(keyword))
    );
  }

  // Sort by date, newest first
  filtered.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  return filtered;
}

/**
 * Clear old articles (older than 90 days)
 */
export async function cleanOldArticles() {
  const articleIds = await getArticleIds();
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const updatedIds = [];

  for (const link of articleIds) {
    const article = await db.get(`article:${link}`);
    if (article && new Date(article.pubDate) >= ninetyDaysAgo) {
      updatedIds.push(link);
    } else {
      await db.delete(`article:${link}`);
    }
  }

  await db.set('articleIds', updatedIds);
  return { removed: articleIds.length - updatedIds.length };
}

export default db;
