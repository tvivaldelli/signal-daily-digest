import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 5 minutes for insight generation (Claude needs time to analyze)
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Fetch articles with optional filters
 * @param {Object} filters - { category, source, startDate, endDate, keyword }
 * @returns {Promise<Array>} - Array of articles
 */
export async function getArticles(filters = {}) {
  try {
    const params = new URLSearchParams();

    if (filters.category) params.append('category', filters.category);
    if (filters.source) params.append('source', filters.source);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.keyword) params.append('keyword', filters.keyword);

    const response = await api.get(`/api/articles?${params.toString()}`);
    return response.data.articles;
  } catch (error) {
    console.error('Error fetching articles:', error);
    throw error;
  }
}

/**
 * Trigger manual refresh of articles
 * @returns {Promise<Object>} - Result with count and articles
 */
export async function refreshArticles() {
  try {
    const response = await api.post('/api/refresh');
    return response.data;
  } catch (error) {
    console.error('Error refreshing articles:', error);
    throw error;
  }
}

/**
 * Get list of configured news sources
 * @returns {Promise<Array>} - Array of source objects
 */
export async function getSources() {
  try {
    const response = await api.get('/api/sources');
    return response.data.sources;
  } catch (error) {
    console.error('Error fetching sources:', error);
    throw error;
  }
}

/**
 * Get list of available categories
 * @returns {Promise<Array>} - Array of category strings
 */
export async function getCategories() {
  try {
    const response = await api.get('/api/categories');
    return response.data.categories;
  } catch (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }
}

/**
 * Generate AI-powered insights from articles
 * @param {Array} articles - Array of article objects
 * @param {String} category - Category for caching insights (optional)
 * @returns {Promise<Object>} - Insights organized by themes
 */
export async function generateInsights(articles, category = 'all') {
  try {
    const response = await api.post('/api/insights', { articles, category });
    return response.data;
  } catch (error) {
    console.error('Error generating insights:', error);
    throw error;
  }
}

/**
 * Get archived insights history
 * @param {Object} filters - { category, startDate, endDate, limit }
 * @returns {Promise<Array>} - Array of archived insights
 */
export async function getArchivedInsights(filters = {}) {
  try {
    const params = new URLSearchParams();

    if (filters.category) params.append('category', filters.category);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.limit) params.append('limit', filters.limit);

    const response = await api.get(`/api/insights/archive?${params.toString()}`);
    return response.data.archives;
  } catch (error) {
    console.error('Error fetching archived insights:', error);
    throw error;
  }
}

/**
 * Get a specific archived insight by ID
 * @param {Number} id - Archive ID
 * @returns {Promise<Object>} - Archived insight object
 */
export async function getArchivedInsightById(id) {
  try {
    const response = await api.get(`/api/insights/archive/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching archived insight:', error);
    throw error;
  }
}

/**
 * Search archived insights by keyword
 * @param {String} query - Search keyword
 * @param {Object} filters - { category }
 * @returns {Promise<Array>} - Array of matching archived insights
 */
export async function searchArchivedInsights(query, filters = {}) {
  try {
    const params = new URLSearchParams();
    params.append('q', query);

    if (filters.category) params.append('category', filters.category);

    const response = await api.get(`/api/insights/search?${params.toString()}`);
    return response.data.results;
  } catch (error) {
    console.error('Error searching insights:', error);
    throw error;
  }
}

/**
 * Force refresh insights (password protected)
 * @param {String} password - Admin password
 * @param {String} category - Category to refresh (default: 'all')
 * @returns {Promise<Object>} - Result with cleared count and next refresh time
 */
export async function forceRefreshInsights(password, category = 'all') {
  try {
    const response = await api.post('/api/insights/refresh', { password, category });
    return response.data;
  } catch (error) {
    // Return error response data if available (for 401, 429, etc.)
    if (error.response?.data) {
      return error.response.data;
    }
    console.error('Error force refreshing insights:', error);
    throw error;
  }
}

/**
 * Get force refresh cooldown status
 * @returns {Promise<Object>} - { canRefresh, cooldownRemaining, nextRefreshAt }
 */
export async function getRefreshStatus() {
  try {
    const response = await api.get('/api/insights/refresh/status');
    return response.data;
  } catch (error) {
    console.error('Error getting refresh status:', error);
    throw error;
  }
}

export default api;
