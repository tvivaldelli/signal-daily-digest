import { useState, useEffect } from 'react';
import { getSources } from '../services/api';
import './FilterBar.css';

export default function FilterBar({ onFilterChange, onRefresh, isRefreshing, selectedCategory }) {
  const [sources, setSources] = useState([]);
  const [allSources, setAllSources] = useState([]);
  const [filters, setFilters] = useState({
    source: '',
    keyword: ''
  });

  useEffect(() => {
    loadSources();
  }, []);

  useEffect(() => {
    // Filter sources based on selected category
    if (selectedCategory && selectedCategory !== 'all') {
      const filtered = allSources.filter(s => s.category === selectedCategory);
      setSources(filtered);
    } else {
      setSources(allSources);
    }
    // Clear source filter when category changes
    handleFilterChange('source', '');
  }, [selectedCategory, allSources]);

  async function loadSources() {
    try {
      const sourcesData = await getSources();
      setAllSources(sourcesData);
      setSources(sourcesData);
    } catch (error) {
      console.error('Failed to load sources:', error);
    }
  }

  function handleFilterChange(key, value) {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  }

  function handleClearFilters() {
    const clearedFilters = {
      source: '',
      keyword: ''
    };
    setFilters(clearedFilters);
    onFilterChange(clearedFilters);
  }

  return (
    <div className="filter-bar">
      <div className="filter-controls">
        <div className="filter-group">
          <label htmlFor="source-filter">Source</label>
          <select
            id="source-filter"
            value={filters.source}
            onChange={(e) => handleFilterChange('source', e.target.value)}
            className="filter-input"
          >
            <option value="">All Sources</option>
            {sources.map((source) => (
              <option key={source.name} value={source.name}>
                {source.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="keyword-filter">Keyword</label>
          <input
            id="keyword-filter"
            type="text"
            placeholder="Search articles..."
            value={filters.keyword}
            onChange={(e) => handleFilterChange('keyword', e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-actions">
          <button onClick={handleClearFilters} className="btn btn-secondary">
            Clear Filters
          </button>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="btn btn-primary"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Articles'}
          </button>
        </div>
      </div>
    </div>
  );
}
