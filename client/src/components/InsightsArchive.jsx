import { useState, useEffect } from 'react';
import { getArchivedInsights, getArchivedInsightById } from '../services/api';
import { formatDateTime, formatCategoryName, getTodayString } from '../utils/formatting';
import './InsightsArchive.css';

export default function InsightsArchive() {
  const [archives, setArchives] = useState([]);
  const [allArchives, setAllArchives] = useState([]); // Store all archives for client-side date filtering
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetails, setExpandedDetails] = useState({});

  // Load all archives on mount and when category changes
  useEffect(() => {
    loadArchives();
  }, [categoryFilter]);

  // Filter archives by date on client side
  useEffect(() => {
    filterByDate();
  }, [dateFilter, allArchives]);

  async function loadArchives() {
    try {
      setLoading(true);
      setError(null);
      const filters = {};
      if (categoryFilter) filters.category = categoryFilter;

      const data = await getArchivedInsights(filters);
      setAllArchives(data);
      // Initial filter will be applied by the useEffect
    } catch (err) {
      setError('Failed to load archived insights');
      console.error('Error loading archives:', err);
    } finally {
      setLoading(false);
    }
  }

  function filterByDate() {
    if (!dateFilter) {
      setArchives(allArchives);
      return;
    }

    // Parse the selected date as local date parts
    const [year, month, day] = dateFilter.split('-').map(Number);

    const filtered = allArchives.filter(archive => {
      const archiveDate = new Date(archive.generatedAt);
      // Compare using local date parts
      return (
        archiveDate.getFullYear() === year &&
        archiveDate.getMonth() === month - 1 && // JS months are 0-indexed
        archiveDate.getDate() === day
      );
    });
    setArchives(filtered);
  }

  function clearDateFilter() {
    setDateFilter('');
    setArchives(allArchives);
  }

  // Load full details when expanding a card
  async function handleExpand(archive) {
    if (expandedId === archive.id) {
      setExpandedId(null);
      return;
    }

    // Check if we already have the details cached
    if (expandedDetails[archive.id]) {
      setExpandedId(archive.id);
      return;
    }

    try {
      const fullInsight = await getArchivedInsightById(archive.id);
      setExpandedDetails(prev => ({
        ...prev,
        [archive.id]: fullInsight
      }));
      setExpandedId(archive.id);
    } catch (err) {
      console.error('Error loading insight detail:', err);
    }
  }

  return (
    <div className="insights-archive">
      {/* Header */}
      <div className="archive-header">
        <h2>Insights Archive</h2>
        <p className="archive-subtitle">Browse past insights by category</p>
      </div>

      {/* Filter Bar with Category Chips and Date Picker */}
      <div className="filter-bar">
        {/* Category Filter Chips */}
        <div className="filter-row">
          <div className="category-chips">
            <button
              className={`category-chip ${categoryFilter === '' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('')}
            >
              All
            </button>
            <button
              className={`category-chip mortgage ${categoryFilter === 'mortgage' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('mortgage')}
            >
              Mortgage
            </button>
            <button
              className={`category-chip product-management ${categoryFilter === 'product-management' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('product-management')}
            >
              Product Management
            </button>
            <button
              className={`category-chip competitor-intel ${categoryFilter === 'competitor-intel' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('competitor-intel')}
            >
              Competitor Intel
            </button>
          </div>

          {/* Date Picker */}
          <div className="date-picker-container">
            <label className="date-picker-label">Filter by date:</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="date-picker"
              max={getTodayString()}
            />
            {dateFilter && (
              <button className="clear-date" onClick={clearDateFilter}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="archive-loading">
          <div className="spinner"></div>
          <p>Loading archived insights...</p>
        </div>
      ) : error ? (
        <div className="archive-error">{error}</div>
      ) : archives.length === 0 ? (
        <div className="archive-empty">
          <p>No archived insights found
            {categoryFilter ? ` for ${formatCategoryName(categoryFilter)}` : ''}
            {dateFilter ? ` on ${new Date(dateFilter + 'T00:00:00').toLocaleDateString()}` : ''}.
          </p>
          {(dateFilter || categoryFilter) && (
            <button className="clear-date-empty" onClick={() => { setCategoryFilter(''); setDateFilter(''); }}>
              Show All
            </button>
          )}
          <p className="empty-hint">Insights are automatically archived when generated.</p>
        </div>
      ) : (
        <div className="archive-list">
          {archives.map((archive) => {
            const isExpanded = expandedId === archive.id;
            const details = expandedDetails[archive.id];

            return (
              <div
                key={archive.id}
                id={`archive-card-${archive.id}`}
                className={`archive-card ${isExpanded ? 'expanded' : ''}`}
              >
                {/* Card Header */}
                <div className="archive-card-header">
                  <div className="archive-card-header-left">
                    <span className="archive-date-badge">{formatDateTime(archive.generatedAt)}</span>
                    <span className={`category-badge ${archive.category}`}>
                      {formatCategoryName(archive.category)}
                    </span>
                  </div>
                </div>

                {/* Card Body - TL;DR (always visible) */}
                <div className="archive-card-body">
                  {archive.tldr && archive.tldr.length > 0 && (
                    <div className="tldr-section">
                      <div className="tldr-label">TL;DR</div>
                      <ul className="tldr-list">
                        {archive.tldr.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Expand button - only show when collapsed */}
                  {!isExpanded && (
                    <button
                      className="expand-insights-btn"
                      onClick={() => handleExpand(archive)}
                    >
                      ▼ View Full Insights
                    </button>
                  )}
                </div>

                {/* Expanded Detail Section */}
                {isExpanded && details && (
                  <div className="archive-card-detail">
                    {/* Recommended Actions */}
                    {details.recommendedActions && details.recommendedActions.length > 0 && (
                      <div className="detail-section">
                        <h3>
                          <span className="section-icon">🎯</span>
                          Recommended Actions
                        </h3>
                        <div className="actions-grid">
                          {details.recommendedActions.map((action, index) => (
                            <div key={index} className="action-card">
                              <div className="action-header">
                                <span className="action-category-tag">{action.category}</span>
                              </div>
                              <p className="action-text">{action.action}</p>
                              {action.rationale && (
                                <p className="action-rationale">{action.rationale}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Themes */}
                    {details.themes && details.themes.length > 0 && (
                      <div className="detail-section">
                        <h3>
                          <span className="section-icon">💡</span>
                          Themes
                        </h3>
                        <div className="themes-list">
                          {details.themes.map((theme, index) => (
                            <div key={index} className="theme-card">
                              <h4>
                                <span className="theme-icon">{theme.icon}</span>
                                {theme.name}
                              </h4>
                              {theme.insights && theme.insights.map((insight, idx) => (
                                <p key={idx} className="theme-insight">{insight.text}</p>
                              ))}
                              {theme.actions && theme.actions.length > 0 && (
                                <div className="theme-actions-mini">
                                  <strong>Actions:</strong>
                                  <ul>
                                    {theme.actions.map((action, idx) => (
                                      <li key={idx}>{action.action}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Bottom collapse button */}
                    <button
                      className="expand-insights-btn bottom"
                      onClick={() => handleExpand(archive)}
                    >
                      ▲ Hide Full Insights
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
