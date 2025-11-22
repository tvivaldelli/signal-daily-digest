import { useState, useEffect } from 'react';
import { getArticles, refreshArticles, generateInsights, getCategories } from '../services/api';
import ArticleCard from './ArticleCard';
import InsightsSummary from './InsightsSummary';
import './Dashboard.css';

export default function Dashboard() {
  const [articles, setArticles] = useState([]);
  const [allArticles, setAllArticles] = useState([]); // Store all articles for insights
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({});
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Load categories and articles on mount
  useEffect(() => {
    loadCategoriesAndArticles();
  }, []);

  // Filter articles locally when filters or category change (no API call, no flicker)
  useEffect(() => {
    if (allArticles.length > 0) {
      filterArticles();
    }
  }, [filters, selectedCategory, allArticles]);

  // Load categories from API
  async function loadCategoriesAndArticles() {
    try {
      const cats = await getCategories();
      setCategories(cats);
      await loadAllArticlesAndInsights();
    } catch (err) {
      console.error('Error loading categories:', err);
      await loadAllArticlesAndInsights();
    }
  }

  // Load all articles and generate insights ONCE on initial load
  async function loadAllArticlesAndInsights() {
    try {
      setLoading(true);
      setError(null);
      const data = await getArticles({}); // Get all articles without filters
      setAllArticles(data);
      setArticles(data);
      setLoading(false); // Show articles immediately

      // Generate insights in the background (non-blocking)
      if (data && data.length > 0) {
        loadInsightsForCategory(data, 'all'); // No await - runs in background
      }
    } catch (err) {
      setError('Failed to load articles. Please try again.');
      console.error('Error loading articles:', err);
      setLoading(false);
    }
  }

  // Regenerate insights when category changes
  useEffect(() => {
    if (allArticles.length > 0 && selectedCategory) {
      const categoryArticles = selectedCategory === 'all'
        ? allArticles
        : allArticles.filter(a => a.category === selectedCategory);

      if (categoryArticles.length > 0) {
        loadInsightsForCategory(categoryArticles, selectedCategory);
      } else {
        setInsights(null);
        setInsightsError(null);
      }
    }
  }, [selectedCategory, allArticles]);

  // Filter articles on the frontend (instant, no loading state)
  function filterArticles() {
    let filtered = [...allArticles];

    // Apply category filter
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter(a => a.category === selectedCategory);
    }

    // Apply source filter
    if (filters.source) {
      filtered = filtered.filter(a => a.source === filters.source);
    }

    // Apply date range filters
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

    // Apply keyword filter
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(keyword) ||
        (a.summary && a.summary.toLowerCase().includes(keyword))
      );
    }

    // Sort by date, newest first
    filtered.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    setArticles(filtered);
  }

  async function loadInsightsForCategory(articlesData, category) {
    try {
      setInsightsLoading(true);
      setInsightsError(null);
      console.log(`Generating insights for category: ${category} (${articlesData.length} articles)`);
      const insightsData = await generateInsights(articlesData, category);
      setInsights(insightsData);
    } catch (err) {
      setInsightsError('Unable to generate insights at this time.');
      console.error('Error generating insights:', err);
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handleRefresh() {
    try {
      setRefreshing(true);
      setError(null);
      const result = await refreshArticles();
      console.log(`Refreshed ${result.count} articles`);

      // Reload all articles and regenerate insights after refresh
      await loadAllArticlesAndInsights();
    } catch (err) {
      setError('Failed to refresh articles. Please try again.');
      console.error('Error refreshing articles:', err);
    } finally {
      setRefreshing(false);
    }
  }

  function handleFilterChange(newFilters) {
    setFilters(newFilters);
  }

  function handleSourceFilter(source) {
    if (filters.source === source) {
      // Clicking the same source clears the filter
      setFilters({ ...filters, source: '' });
    } else {
      setFilters({ ...filters, source });
    }
  }

  // Get unique sources for the current category
  function getSourcesForCategory() {
    const categoryArticles = selectedCategory === 'all'
      ? allArticles
      : allArticles.filter(a => a.category === selectedCategory);

    const sources = [...new Set(categoryArticles.map(a => a.source))].sort();
    return sources;
  }

  // Calculate date range from articles
  function getDateInfo() {
    if (allArticles.length === 0) return null;

    const dates = allArticles.map(a => new Date(a.pubDate)).sort((a, b) => a - b);
    const oldestDate = dates[0];
    const newestDate = dates[dates.length - 1];

    // Format date range
    const formatDate = (date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const dateRange = oldestDate.toDateString() === newestDate.toDateString()
      ? formatDate(newestDate)
      : `${formatDate(oldestDate)} - ${formatDate(newestDate)}`;

    // Calculate time ago for insights
    let insightsAge = '';
    if (insights?.generatedAt) {
      const now = new Date();
      const generated = new Date(insights.generatedAt);
      const diffMs = now - generated;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) {
        insightsAge = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else if (diffHours > 0) {
        insightsAge = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      } else if (diffMins > 0) {
        insightsAge = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      } else {
        insightsAge = 'just now';
      }
    }

    return { dateRange, insightsAge };
  }

  const dateInfo = getDateInfo();

  // Format category name for display
  function formatCategoryName(category) {
    if (category === 'all') return 'All Content';
    return category.split('-').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div>
            <h1>News Monitor</h1>
            <p className="subtitle">Stay updated with industry news and insights</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="refresh-button"
            title="Refresh articles"
          >
            {refreshing ? '↻' : '↻'}
          </button>
        </div>
      </header>

      {dateInfo && (
        <div className="date-info-bar">
          <span className="info-item">
            <span className="info-icon">📅</span>
            <span className="info-text">Articles: {dateInfo.dateRange}</span>
          </span>
          {dateInfo.insightsAge && (
            <span className="info-item">
              <span className="info-icon">🔄</span>
              <span className="info-text">Updated: {dateInfo.insightsAge}</span>
            </span>
          )}
          <span className="info-item">
            <span className="info-icon">⏰</span>
            <span className="info-text">Next refresh: 8:00 AM EST</span>
          </span>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {categories.length > 0 && (
        <div className="category-pills">
          <button
            className={`category-pill ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            All Content ({allArticles.length})
          </button>
          {categories.map(category => {
            const count = allArticles.filter(a => a.category === category).length;
            return (
              <button
                key={category}
                className={`category-pill ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category)}
              >
                {formatCategoryName(category)} ({count})
              </button>
            );
          })}
        </div>
      )}

      {!loading && articles.length > 0 && (
        <InsightsSummary
          insights={insights}
          loading={insightsLoading}
          error={insightsError}
        />
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading articles...</p>
        </div>
      ) : articles.length === 0 ? (
        <div className="empty-state">
          <h2>No articles found</h2>
          <p>Try adjusting your filters or click the refresh button to fetch new content.</p>
        </div>
      ) : (
        <div className="articles-container">
          {/* Source filter pills */}
          <div className="source-filters">
            <span className="filter-label">Filter by source:</span>
            <div className="source-pills">
              <button
                className={`source-pill ${!filters.source ? 'active' : ''}`}
                onClick={() => setFilters({ ...filters, source: '' })}
              >
                All Sources
              </button>
              {getSourcesForCategory().map(source => {
                const categoryArticles = selectedCategory === 'all'
                  ? allArticles
                  : allArticles.filter(a => a.category === selectedCategory);
                const count = categoryArticles.filter(a => a.source === source).length;
                return (
                  <button
                    key={source}
                    className={`source-pill ${filters.source === source ? 'active' : ''}`}
                    onClick={() => handleSourceFilter(source)}
                  >
                    {source} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="articles-list">
            {articles.map((article) => (
              <ArticleCard key={article.link} article={article} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
