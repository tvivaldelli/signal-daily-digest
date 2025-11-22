import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
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

export default api;
