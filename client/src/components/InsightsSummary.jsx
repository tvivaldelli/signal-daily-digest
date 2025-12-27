import { useState, useEffect, useRef } from 'react';
import { getTimeAgo } from '../utils/formatting';
import CarouselSlides, { buildSlides } from './CarouselSlides';
import './InsightsSummary.css';

export default function InsightsSummary({ insights, loading, error, multiDomain = false }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [activeDomain, setActiveDomain] = useState('mortgage');
  const carouselRef = useRef(null);

  // Keyboard navigation
  useEffect(() => {
    if (!insights || !insights.themes || insights.themes.length === 0) return;

    const handleKeyDown = (e) => {
      if (!isExpanded) return;
      if (e.key === 'ArrowLeft' && currentSlide > 0) {
        setCurrentSlide(prev => prev - 1);
      }
      if (e.key === 'ArrowRight') {
        const totalSlides = (insights.recommendedActions?.length > 0 ? 1 : 0) + insights.themes.length;
        if (currentSlide < totalSlides - 1) {
          setCurrentSlide(prev => prev + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, currentSlide, insights]);

  if (loading) {
    return (
      <div className="insights-summary loading">
        <div className="insights-header">
          <h2>Generating Key Insights...</h2>
        </div>
        <div className="insights-loading">
          <div className="spinner"></div>
          <p>Analyzing articles with AI...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="insights-summary error">
        <div className="insights-header">
          <h2>Insights Unavailable</h2>
        </div>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  // Handle multi-domain view
  if (multiDomain && insights?.mortgage && insights?.productManagement) {
    const currentInsights = activeDomain === 'mortgage'
      ? insights.mortgage
      : activeDomain === 'productManagement'
        ? insights.productManagement
        : insights.competitorIntel;

    if (!currentInsights || !currentInsights.success) {
      return null;
    }

    const tldrBullets = currentInsights?.tldr || [];
    const slides = buildSlides(currentInsights);

    return (
      <div className={`insights-summary carousel-layout ${!isExpanded ? 'collapsed' : ''}`}>
        <div className="insights-header">
          <div className="header-content">
            <h2>🔍 Key Insights</h2>
            <div className="domain-tabs" role="tablist" aria-label="Domain insights">
              <button
                className={`domain-tab ${activeDomain === 'mortgage' ? 'active' : ''}`}
                onClick={() => {
                  setActiveDomain('mortgage');
                  setCurrentSlide(0);
                  setIsExpanded(false);
                }}
                role="tab"
                aria-selected={activeDomain === 'mortgage'}
                aria-controls="domain-insights-panel"
              >
                🏠 Mortgage
              </button>
              <button
                className={`domain-tab ${activeDomain === 'productManagement' ? 'active' : ''}`}
                onClick={() => {
                  setActiveDomain('productManagement');
                  setCurrentSlide(0);
                  setIsExpanded(false);
                }}
                role="tab"
                aria-selected={activeDomain === 'productManagement'}
                aria-controls="domain-insights-panel"
              >
                📊 Product Management
              </button>
              {insights.competitorIntel && (
                <button
                  className={`domain-tab ${activeDomain === 'competitorIntel' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveDomain('competitorIntel');
                    setCurrentSlide(0);
                    setIsExpanded(false);
                  }}
                  role="tab"
                  aria-selected={activeDomain === 'competitorIntel'}
                  aria-controls="domain-insights-panel"
                >
                  🎯 Competitor Intel
                </button>
              )}
            </div>
          </div>
        </div>

        <div role="tabpanel" id="domain-insights-panel">
          <TldrSummary bullets={tldrBullets} isExpanded={isExpanded} />

          {isExpanded && (
            <CarouselSlides
              ref={carouselRef}
              slides={slides}
              currentSlide={currentSlide}
              onSlideChange={setCurrentSlide}
              showFallback={currentInsights.fallback}
            />
          )}
        </div>

        <ExpandButton isExpanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)} />
      </div>
    );
  }

  // Single domain validation
  if (!insights || !insights.success || !insights.themes || insights.themes.length === 0) {
    return null;
  }

  const slides = buildSlides(insights);
  const insightsTimestamp = getTimeAgo(insights?.generatedAt);
  const tldrBullets = insights?.tldr || [];

  // Single domain view
  return (
    <div className={`insights-summary carousel-layout ${!isExpanded ? 'collapsed' : ''}`}>
      <div className="insights-header">
        <div className="header-content">
          <h2>🔍 Key Insights</h2>
          <span className="insights-meta">
            {insights.themes.length} theme{insights.themes.length > 1 ? 's' : ''} • {insights.articleCount} articles analyzed
            {insightsTimestamp && (
              <span className="insights-refresh-info">
                <br/>Generated {insightsTimestamp} • Refreshes daily with articles at 8am
              </span>
            )}
          </span>
        </div>
      </div>

      <TldrSummary bullets={tldrBullets} isExpanded={isExpanded} />

      {isExpanded && (
        <CarouselSlides
          ref={carouselRef}
          slides={slides}
          currentSlide={currentSlide}
          onSlideChange={setCurrentSlide}
          showFallback={insights.fallback}
        />
      )}

      <ExpandButton isExpanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)} />
    </div>
  );
}

/**
 * TL;DR Summary component - shown when collapsed
 */
function TldrSummary({ bullets, isExpanded }) {
  if (isExpanded || !bullets || bullets.length === 0) return null;

  return (
    <div className="tldr-summary">
      <div className="tldr-title">TL;DR Summary</div>
      <ul className="tldr-list">
        {bullets.map((bullet, index) => (
          <li key={index} className="tldr-item">{bullet}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Expand/Collapse button component
 */
function ExpandButton({ isExpanded, onClick }) {
  return (
    <div className="insights-footer">
      <button
        className="expand-toggle-btn"
        onClick={onClick}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse to show summary' : 'Expand to show full insights'}
      >
        {isExpanded ? '▲ Show Summary' : '▼ Show Full Insights'}
      </button>
    </div>
  );
}
