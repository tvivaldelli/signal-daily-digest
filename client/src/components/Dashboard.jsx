import { useState, useEffect, useRef } from 'react';
import { getArticles, generateInsights, getCategories, forceRefreshInsights, getRefreshStatus } from '../services/api';
import ArticleCard from './ArticleCard';
import InsightsSummary from './InsightsSummary';
import InsightsArchive from './InsightsArchive';
import { getTimeAgo, formatDate, formatFullDate, formatCategoryName } from '../utils/formatting';
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

  // Force refresh state
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [refreshPassword, setRefreshPassword] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [rememberPassword, setRememberPassword] = useState(false);

  // Request ID ref to prevent race conditions when switching categories rapidly
  const insightsRequestIdRef = useRef(0);

  // Load categories and articles on mount
  useEffect(() => {
    loadCategoriesAndArticles();
    checkRefreshStatus();
    // Load saved password from localStorage if "remember me" was checked
    const savedPassword = localStorage.getItem('refreshPassword');
    if (savedPassword) {
      setRefreshPassword(savedPassword);
      setRememberPassword(true);
    }
  }, []);

  // Update cooldown timer every second when in cooldown
  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setInterval(() => {
        setCooldownRemaining(prev => {
          if (prev <= 1000) {
            setCanRefresh(true);
            return 0;
          }
          return prev - 1000;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownRemaining > 0]);

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
        insightsRequestIdRef.current += 1;
        loadInsightsForCategory(data, 'all', insightsRequestIdRef.current); // No await - runs in background
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
      // Increment request ID to invalidate any pending requests (prevents race conditions)
      insightsRequestIdRef.current += 1;
      const currentRequestId = insightsRequestIdRef.current;

      if (selectedCategory === 'all') {
        // Load insights for both mortgage and product-management
        const mortgageArticles = allArticles.filter(a => a.category === 'mortgage');
        const pmArticles = allArticles.filter(a => a.category === 'product-management');

        if (mortgageArticles.length > 0) {
          loadInsightsForCategory(mortgageArticles, 'mortgage', currentRequestId);
        }
        if (pmArticles.length > 0) {
          loadInsightsForCategory(pmArticles, 'product-management', currentRequestId);
        }
        const competitorArticles = allArticles.filter(a => a.category === 'competitor-intel');
        if (competitorArticles.length > 0) {
          loadInsightsForCategory(competitorArticles, 'competitor-intel', currentRequestId);
        }
      } else {
        // Load insights for single category
        const categoryArticles = allArticles.filter(a => a.category === selectedCategory);
        if (categoryArticles.length > 0) {
          loadInsightsForCategory(categoryArticles, selectedCategory, currentRequestId);
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

  async function loadInsightsForCategory(articlesData, category, requestId) {
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

      // Only update state if this request is still current (prevents race conditions)
      if (requestId === insightsRequestIdRef.current) {
        setInsightsByCategory(prev => ({
          ...prev,
          [category]: insightsData
        }));
      } else {
        console.log(`Discarding stale insights response for ${category} (request ${requestId} < current ${insightsRequestIdRef.current})`);
      }
    } catch (err) {
      // Only update error state if this request is still current
      if (requestId === insightsRequestIdRef.current) {
        setInsightsError('Unable to generate insights at this time.');
      }
      console.error('Error generating insights:', err);
    } finally {
      // Only update loading state if this request is still current
      if (requestId === insightsRequestIdRef.current) {
        setInsightsLoading(false);
      }
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

  // Force refresh functions
  async function checkRefreshStatus() {
    try {
      const status = await getRefreshStatus();
      setCanRefresh(status.canRefresh);
      setCooldownRemaining(status.cooldownRemaining || 0);
    } catch (err) {
      console.error('Error checking refresh status:', err);
    }
  }

  function openRefreshModal() {
    setRefreshError('');
    setShowRefreshModal(true);
  }

  function closeRefreshModal() {
    setShowRefreshModal(false);
    setRefreshError('');
    // Only clear password if "remember me" is not checked
    if (!rememberPassword) {
      setRefreshPassword('');
    }
  }

  async function handleForceRefresh() {
    if (!refreshPassword.trim()) {
      setRefreshError('Please enter the admin password');
      return;
    }

    setRefreshing(true);
    setRefreshError('');

    const result = await forceRefreshInsights(refreshPassword, 'all');

    setRefreshing(false);

    if (result.success) {
      // Save password if "remember me" is checked
      if (rememberPassword) {
        localStorage.setItem('refreshPassword', refreshPassword);
      } else {
        localStorage.removeItem('refreshPassword');
      }

      // Update cooldown state
      setCanRefresh(false);
      setCooldownRemaining(60 * 60 * 1000); // 1 hour

      // Close modal
      closeRefreshModal();

      // Clear frontend insights cache and force full reload
      // Using window.location.reload() to ensure clean state
      setInsightsByCategory({});
      window.location.reload();
    } else {
      // Handle errors
      if (result.error === 'Unauthorized') {
        setRefreshError('Invalid password');
        // Clear saved password if it was wrong
        localStorage.removeItem('refreshPassword');
      } else if (result.error === 'Rate limited') {
        setRefreshError(result.message);
        setCooldownRemaining(result.cooldownRemaining || 0);
        setCanRefresh(false);
        closeRefreshModal();
      } else {
        setRefreshError(result.message || 'Failed to refresh insights');
      }
    }
  }

  function formatCooldown(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes >= 60) {
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
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

    const dateRange = oldestDate.toDateString() === newestDate.toDateString()
      ? formatDate(newestDate.toISOString())
      : `${formatDate(oldestDate.toISOString())} - ${formatDate(newestDate.toISOString())}`;

    const updatedAsOf = formatFullDate(newestDate.toISOString());

    // Calculate time ago for insights using shared util
    const currentInsights = insightsByCategory[selectedCategory];
    const insightsAge = currentInsights?.generatedAt
      ? getTimeAgo(currentInsights.generatedAt)
      : '';

    return { dateRange, insightsAge, updatedAsOf };
  }

  const dateInfo = getDateInfo();

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
          <div className="main-tabs" role="tablist" aria-label="Insights navigation">
            <button
              className={`main-tab ${activeTab === 'insights' ? 'active' : ''}`}
              onClick={() => setActiveTab('insights')}
              role="tab"
              aria-selected={activeTab === 'insights'}
              aria-controls="insights-panel"
              id="insights-tab"
            >
              Current Insights
            </button>
            <button
              className={`main-tab ${activeTab === 'archive' ? 'active' : ''}`}
              onClick={() => setActiveTab('archive')}
              role="tab"
              aria-selected={activeTab === 'archive'}
              aria-controls="archive-panel"
              id="archive-tab"
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
        <div role="tabpanel" id="archive-panel" aria-labelledby="archive-tab">
          <InsightsArchive />
        </div>
      )}

      {/* Force Refresh Modal */}
      {showRefreshModal && (
        <div className="modal-overlay" onClick={closeRefreshModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Force Refresh Insights</h3>
            <p className="modal-description">
              This will clear all cached insights and regenerate them.
              This action has a 1-hour cooldown.
            </p>

            <div className="modal-form">
              <label htmlFor="refresh-password">Admin Password:</label>
              <input
                id="refresh-password"
                type="password"
                value={refreshPassword}
                onChange={e => setRefreshPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleForceRefresh()}
                placeholder="Enter password"
                autoFocus
                disabled={refreshing}
              />

              <label className="remember-checkbox">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={e => setRememberPassword(e.target.checked)}
                  disabled={refreshing}
                />
                Remember password
              </label>

              {refreshError && (
                <div className="modal-error">{refreshError}</div>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={closeRefreshModal}
                disabled={refreshing}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleForceRefresh}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current Insights View */}
      {activeTab === 'insights' && (
        <div role="tabpanel" id="insights-panel" aria-labelledby="insights-tab">
          {/* Category Filters */}
          {allArticles.length > 0 && (
            <div className="unified-filters">
              <div className="filter-header-row">
                {dateInfo?.updatedAsOf && (
                  <div className="updated-label">
                    Updated as of {dateInfo.updatedAsOf}
                    <span className="refresh-schedule"> • Insights refresh Mon & Thu at 8am EST</span>
                    <button
                      className={`refresh-btn ${!canRefresh ? 'disabled' : ''}`}
                      onClick={openRefreshModal}
                      disabled={!canRefresh}
                      title={canRefresh ? 'Force refresh insights' : `Next refresh in ${formatCooldown(cooldownRemaining)}`}
                      aria-label="Force refresh insights"
                    >
                      {canRefresh ? '↻' : formatCooldown(cooldownRemaining)}
                    </button>
                  </div>
                )}
              </div>

              {categories.length > 0 && (
                <div className="filter-group" role="group" aria-label="Filter by domain">
                  <span className="filter-label" id="domain-filter-label">Domain:</span>
                  <div className="filter-buttons" role="radiogroup" aria-labelledby="domain-filter-label">
                    <button
                      className={`filter-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory('all')}
                      role="radio"
                      aria-checked={selectedCategory === 'all'}
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
                          role="radio"
                          aria-checked={selectedCategory === category}
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
                ? { mortgage: insightsByCategory['mortgage'], productManagement: insightsByCategory['product-management'], competitorIntel: insightsByCategory['competitor-intel'] }
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
        </div>
      )}
    </div>
  );
}
