import { useState, useEffect } from 'react';
import { getArticles, generateInsights, getCategories } from '../services/api';
import ArticleCard from './ArticleCard';
import InsightsSummary from './InsightsSummary';
import InsightsArchive from './InsightsArchive';
import './Dashboard.css';

export default function Dashboard() {
  const [articles, setArticles] = useState([]);
  const [allArticles, setAllArticles] = useState([]); // Store all articles for insights
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({});
  const [insightsByCategory, setInsightsByCategory] = useState({}); // Cache insights by category
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all'); // 'all', 'mortgage', 'product-management'
  const [activeTab, setActiveTab] = useState('insights'); // 'insights' or 'archive'

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
      if (selectedCategory === 'all') {
        // Load insights for both mortgage and product-management
        const mortgageArticles = allArticles.filter(a => a.category === 'mortgage');
        const pmArticles = allArticles.filter(a => a.category === 'product-management');

        if (mortgageArticles.length > 0) {
          loadInsightsForCategory(mortgageArticles, 'mortgage');
        }
        if (pmArticles.length > 0) {
          loadInsightsForCategory(pmArticles, 'product-management');
        }
      } else {
        // Load insights for single category
        const categoryArticles = allArticles.filter(a => a.category === selectedCategory);
        if (categoryArticles.length > 0) {
          loadInsightsForCategory(categoryArticles, selectedCategory);
        } else {
          setInsightsError(null);
        }
      }
    }
  }, [selectedCategory, allArticles]);

  // Filter articles on the frontend (instant, no loading state)
  function filterArticles() {
    let filtered = [...allArticles];

    // Apply 2-week filter by default - matches insights window
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    twoWeeksAgo.setHours(0, 0, 0, 0);
    filtered = filtered.filter(a => new Date(a.pubDate) >= twoWeeksAgo);

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
    // Check if we already have cached insights for this category
    if (insightsByCategory[category]) {
      console.log(`Using cached insights for category: ${category}`);
      return;
    }

    // Filter to last 2 weeks for insights (more actionable, faster, cheaper)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    let recentArticles = articlesData.filter(a => new Date(a.pubDate) >= twoWeeksAgo);

    // Fallback: If < 10 articles in 2 weeks, expand to 30 days
    if (recentArticles.length < 10) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      recentArticles = articlesData.filter(a => new Date(a.pubDate) >= thirtyDaysAgo);
      console.log(`Only ${articlesData.filter(a => new Date(a.pubDate) >= twoWeeksAgo).length} articles in last 2 weeks, expanding to 30 days (${recentArticles.length} articles)`);
    }

    try {
      setInsightsLoading(true);
      setInsightsError(null);
      console.log(`Generating insights for category: ${category} (${recentArticles.length} articles from last 2 weeks)`);
      const insightsData = await generateInsights(recentArticles, category);

      // Cache the insights by category
      setInsightsByCategory(prev => ({
        ...prev,
        [category]: insightsData
      }));
    } catch (err) {
      setInsightsError('Unable to generate insights at this time.');
      console.error('Error generating insights:', err);
    } finally {
      setInsightsLoading(false);
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

    // Format newest date as "Month Day, Year" for "Updated as of"
    const updatedAsOf = newestDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    // Calculate time ago for insights
    let insightsAge = '';
    const currentInsights = insightsByCategory[selectedCategory];
    if (currentInsights?.generatedAt) {
      const now = new Date();
      const generated = new Date(currentInsights.generatedAt);
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

    return { dateRange, insightsAge, updatedAsOf };
  }

  const dateInfo = getDateInfo();

  // Format category name for display
  function formatCategoryName(category) {
    return category.split('-').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-badge">Industry Intelligence Platform</div>
          <h1>
            <span className="header-icon-wrapper">
              <span className="header-icon">💡</span>
            </span>
            Mortgage Intelligence Hub
          </h1>
          <p className="subtitle">Real-time insights for product leaders • Powered by AI</p>

          {/* Main navigation tabs */}
          <div className="main-tabs">
            <button
              className={`main-tab ${activeTab === 'insights' ? 'active' : ''}`}
              onClick={() => setActiveTab('insights')}
            >
              Current Insights
            </button>
            <button
              className={`main-tab ${activeTab === 'archive' ? 'active' : ''}`}
              onClick={() => setActiveTab('archive')}
            >
              Insights Archive
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Archive View */}
      {activeTab === 'archive' && (
        <InsightsArchive />
      )}

      {/* Current Insights View */}
      {activeTab === 'insights' && (
        <>
          {/* Category Filters */}
          {allArticles.length > 0 && (
            <div className="unified-filters">
              <div className="filter-header-row">
                {dateInfo?.updatedAsOf && (
                  <div className="updated-label">
                    Updated as of {dateInfo.updatedAsOf}
                    <span className="refresh-schedule"> • Insights refresh daily at 8am EST</span>
                  </div>
                )}
              </div>

              {categories.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Domain:</span>
                  <div className="filter-buttons">
                    <button
                      className={`filter-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory('all')}
                    >
                      All ({allArticles.length})
                    </button>
                    {categories.map(category => {
                      const count = allArticles.filter(a => a.category === category).length;
                      return (
                        <button
                          key={category}
                          className={`filter-btn ${selectedCategory === category ? 'active' : ''}`}
                          onClick={() => setSelectedCategory(category)}
                        >
                          {formatCategoryName(category)} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && articles.length > 0 && (
            <InsightsSummary
              insights={selectedCategory === 'all'
                ? { mortgage: insightsByCategory['mortgage'], productManagement: insightsByCategory['product-management'] }
                : insightsByCategory[selectedCategory]
              }
              loading={insightsLoading}
              error={insightsError}
              multiDomain={selectedCategory === 'all'}
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
              <p>Try adjusting your filters. Articles are automatically refreshed daily at 8am EST.</p>
            </div>
          ) : (
            <div className="articles-container">
              {/* Compact source filter dropdown */}
              <div className="source-filter-compact">
                <label htmlFor="source-select" className="filter-label-inline">Source:</label>
                <select
                  id="source-select"
                  className="source-select"
                  value={filters.source || ''}
                  onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                >
                  <option value="">All Sources</option>
                  {getSourcesForCategory().map(source => {
                    const categoryArticles = selectedCategory === 'all'
                      ? allArticles
                      : allArticles.filter(a => a.category === selectedCategory);
                    const count = categoryArticles.filter(a => a.source === source).length;
                    return (
                      <option key={source} value={source}>
                        {source} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="articles-list">
                {articles.map((article) => (
                  <ArticleCard key={article.link} article={article} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
