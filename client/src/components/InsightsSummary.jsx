import { useState, useEffect, useRef } from 'react';
import './InsightsSummary.css';

export default function InsightsSummary({ insights, loading, error, multiDomain = false }) {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed to show TL;DR
  const [currentSlide, setCurrentSlide] = useState(0);
  const [activeDomain, setActiveDomain] = useState('mortgage'); // Track which domain to show in multi-domain view
  const carouselRef = useRef(null);

  // Keyboard navigation - must be declared before any returns
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

  // Handle multi-domain view - show tabs to cycle between domains
  if (multiDomain && insights?.mortgage && insights?.productManagement) {
    // Use the active domain's insights
    const currentInsights = activeDomain === 'mortgage' ? insights.mortgage : insights.productManagement;

    if (!currentInsights || !currentInsights.success) {
      return null;
    }

    const tldrBullets = currentInsights?.tldr || [];

    // Build slides
    const slides = [];
    if (currentInsights.recommendedActions && currentInsights.recommendedActions.length > 0) {
      slides.push({ type: 'actions', data: currentInsights.recommendedActions });
    }
    currentInsights.themes.forEach(theme => {
      slides.push({ type: 'theme', data: theme });
    });
    const totalSlides = slides.length;

    return (
      <div className={`insights-summary carousel-layout ${!isExpanded ? 'collapsed' : ''}`}>
        <div className="insights-header">
          <div className="header-content">
            <h2>🔍 Key Insights</h2>

            {/* Domain tabs for cycling */}
            <div className="domain-tabs">
              <button
                className={`domain-tab ${activeDomain === 'mortgage' ? 'active' : ''}`}
                onClick={() => {
                  setActiveDomain('mortgage');
                  setCurrentSlide(0);
                  setIsExpanded(false);
                }}
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
              >
                📊 Product Management
              </button>
            </div>
          </div>
        </div>

        {/* TL;DR Summary - Show when collapsed */}
        {!isExpanded && tldrBullets.length > 0 && (
          <div className="tldr-summary">
            <div className="tldr-title">TL;DR Summary</div>
            <ul className="tldr-list">
              {tldrBullets.map((bullet, index) => (
                <li key={index} className="tldr-item">{bullet}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Full insights carousel - Shown when expanded */}
        {isExpanded && (
          <SingleDomainCarousel
            slides={slides}
            currentSlide={currentSlide}
            setCurrentSlide={setCurrentSlide}
            carouselRef={carouselRef}
            insights={currentInsights}
          />
        )}

        {/* Expand/Collapse button */}
        <div className="insights-footer">
          <button
            className="expand-toggle-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▲ Show Summary' : '▼ Show Full Insights'}
          </button>
        </div>
      </div>
    );
  }

  // Single domain validation
  if (!insights || !insights.success || !insights.themes || insights.themes.length === 0) {
    return null;
  }

  // Build slides array: [recommendedActions (if exists), ...themes]
  const slides = [];
  if (insights.recommendedActions && insights.recommendedActions.length > 0) {
    slides.push({ type: 'actions', data: insights.recommendedActions });
  }
  insights.themes.forEach(theme => {
    slides.push({ type: 'theme', data: theme });
  });

  const totalSlides = slides.length;

  const goToSlide = (index) => {
    const newIndex = Math.max(0, Math.min(index, totalSlides - 1));
    setCurrentSlide(newIndex);
    if (carouselRef.current) {
      const slideWidth = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: slideWidth * newIndex,
        behavior: 'smooth'
      });
    }
  };

  const nextSlide = () => {
    if (currentSlide < totalSlides - 1) {
      goToSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      goToSlide(currentSlide - 1);
    }
  };

  // Calculate time ago for insights timestamp
  const getInsightsTimestamp = () => {
    if (!insights?.generatedAt) return null;

    const now = new Date();
    const generated = new Date(insights.generatedAt);
    const diffMs = now - generated;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let timeAgo;
    if (diffDays > 0) {
      timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
      timeAgo = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else {
      timeAgo = 'just now';
    }

    return timeAgo;
  };

  const insightsTimestamp = getInsightsTimestamp();

  // Use Claude-generated TL;DR directly (no manipulation needed)
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

      {/* TL;DR Summary - Show when collapsed */}
      {!isExpanded && tldrBullets.length > 0 && (
        <div className="tldr-summary">
          <div className="tldr-title">TL;DR Summary</div>
          <ul className="tldr-list">
            {tldrBullets.map((bullet, index) => (
              <li key={index} className="tldr-item">{bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Full Carousel - Show when expanded */}
      {isExpanded && (
      <div className={`insights-body carousel-container`}>
          {totalSlides > 1 && (
            <>
              <button
                className="carousel-nav carousel-prev"
                onClick={prevSlide}
                disabled={currentSlide === 0}
                aria-label="Previous slide"
              >
                ‹
              </button>
              <button
                className="carousel-nav carousel-next"
                onClick={nextSlide}
                disabled={currentSlide === totalSlides - 1}
                aria-label="Next slide"
              >
                ›
              </button>
            </>
          )}

          <div className="carousel-track" ref={carouselRef}>
            {slides.map((slide, index) => (
              <div key={index} className="carousel-slide">
                {slide.type === 'actions' ? (
                  <div className="recommended-actions">
                    <h3 className="actions-title">
                      <span className="actions-icon">🎯</span>
                      Recommended Actions
                    </h3>
                    <div className="actions-list">
                      {slide.data.map((action, actionIndex) => (
                        <div key={actionIndex} className="action-item-compact">
                          <span className="action-category-compact">{action.category}</span>
                          <p className="action-text-compact">{action.action}</p>
                          <p className="action-rationale-compact">{action.rationale}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="theme-section">
                    <h3 className="theme-title">
                      <span className="theme-icon">{slide.data.icon}</span>
                      {slide.data.name}
                    </h3>

                    <div className="insights-list">
                      {slide.data.insights.map((insight, insightIndex) => (
                        <div key={insightIndex} className="insight-item">
                          <p className="insight-text">{insight.text}</p>

                          {insight.articles && insight.articles.length > 0 && (
                            <div className="related-articles">
                              <span className="related-label">Related:</span>
                              <div className="article-chips">
                                {insight.articles.slice(0, 3).map((article, articleIndex) => (
                                  <a
                                    key={articleIndex}
                                    href={article.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="article-chip"
                                    title={article.title}
                                  >
                                    <span className="chip-source">{article.source}</span>
                                  </a>
                                ))}
                                {insight.articles.length > 3 && (
                                  <span className="chip-more">+{insight.articles.length - 3} more</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {slide.data.actions && slide.data.actions.length > 0 && (
                      <div className="theme-actions">
                        <h4 className="theme-actions-title">Actions:</h4>
                        <div className="theme-actions-list">
                          {slide.data.actions.map((action, actionIndex) => (
                            <div key={actionIndex} className="theme-action-item">
                              <span className="theme-action-icon">→</span>
                              <p className="theme-action-text">{action.action}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalSlides > 1 && (
            <div className="carousel-indicators">
              {slides.map((_, index) => (
                <button
                  key={index}
                  className={`carousel-indicator ${index === currentSlide ? 'active' : ''}`}
                  onClick={() => goToSlide(index)}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
          )}

          {insights.fallback && (
            <div className="fallback-notice">
              Note: AI-powered insights are currently unavailable. Showing basic article grouping.
            </div>
          )}
        </div>
      )}

      {/* Show More/Less button */}
      <div className="insights-footer">
        <button
          className="expand-toggle-btn"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '▲ Show Summary' : '▼ Show Full Insights'}
        </button>
      </div>
    </div>
  );
}

// Helper component for rendering a single domain's insights
function SingleDomainInsights({ insights, domainName, domainIcon, domainKey, isExpanded, setExpanded, currentSlide, setCurrentSlide, carouselRef }) {
  if (!insights || !insights.success) return null;

  const tldrBullets = insights?.tldr || [];

  // Build slides array: [recommendedActions (if exists), ...themes]
  const slides = [];
  if (insights.recommendedActions && insights.recommendedActions.length > 0) {
    slides.push({ type: 'actions', data: insights.recommendedActions });
  }
  insights.themes.forEach(theme => {
    slides.push({ type: 'theme', data: theme });
  });

  const totalSlides = slides.length;

  const goToSlide = (index) => {
    const newIndex = Math.max(0, Math.min(index, totalSlides - 1));
    setCurrentSlide(newIndex);
    if (carouselRef.current) {
      const slideWidth = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: slideWidth * newIndex,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={`insights-column ${!isExpanded ? 'collapsed' : ''}`}>
      <div className="insights-header">
        <div className="header-content">
          <h3>{domainIcon} {domainName}</h3>
          <span className="insights-meta">
            {insights.themes.length} theme{insights.themes.length > 1 ? 's' : ''} • {insights.articleCount} articles
          </span>
        </div>
      </div>

      {/* TL;DR Summary - Show when collapsed */}
      {!isExpanded && tldrBullets.length > 0 && (
        <div className="tldr-summary">
          <div className="tldr-title">TL;DR Summary</div>
          <ul className="tldr-list">
            {tldrBullets.map((bullet, index) => (
              <li key={index} className="tldr-item">{bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Full Carousel - Show when expanded */}
      {isExpanded && (
        <div className="insights-body carousel-container">
          {totalSlides > 1 && (
            <>
              <button
                className="carousel-nav carousel-prev"
                onClick={() => goToSlide(currentSlide - 1)}
                disabled={currentSlide === 0}
              >
                ‹
              </button>
              <button
                className="carousel-nav carousel-next"
                onClick={() => goToSlide(currentSlide + 1)}
                disabled={currentSlide === totalSlides - 1}
              >
                ›
              </button>
            </>
          )}

          <div className="carousel-track" ref={carouselRef}>
            {slides.map((slide, index) => (
              <div key={index} className="carousel-slide">
                {slide.type === 'actions' ? (
                  <div className="recommended-actions">
                    <h3 className="actions-title">
                      <span className="actions-icon">🎯</span>
                      Recommended Actions
                    </h3>
                    <div className="actions-list">
                      {slide.data.map((action, actionIndex) => (
                        <div key={actionIndex} className="action-item-compact">
                          <span className="action-category-compact">{action.category}</span>
                          <p className="action-text-compact">{action.action}</p>
                          <p className="action-rationale-compact">{action.rationale}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="theme-section">
                    <h3 className="theme-title">
                      <span className="theme-icon">{slide.data.icon}</span>
                      {slide.data.name}
                    </h3>

                    <div className="insights-list">
                      {slide.data.insights.map((insight, insightIndex) => (
                        <div key={insightIndex} className="insight-item">
                          <p className="insight-text">{insight.text}</p>

                          {insight.articles && insight.articles.length > 0 && (
                            <div className="related-articles">
                              <span className="related-label">Related:</span>
                              <div className="article-chips">
                                {insight.articles.slice(0, 3).map((article, articleIndex) => (
                                  <a
                                    key={articleIndex}
                                    href={article.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="article-chip"
                                    title={article.title}
                                  >
                                    <span className="chip-source">{article.source}</span>
                                  </a>
                                ))}
                                {insight.articles.length > 3 && (
                                  <span className="chip-more">+{insight.articles.length - 3} more</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {slide.data.actions && slide.data.actions.length > 0 && (
                      <div className="theme-actions">
                        <h4 className="theme-actions-title">Actions:</h4>
                        <div className="theme-actions-list">
                          {slide.data.actions.map((action, actionIndex) => (
                            <div key={actionIndex} className="theme-action-item">
                              <span className="theme-action-icon">→</span>
                              <p className="theme-action-text">{action.action}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalSlides > 1 && (
            <div className="carousel-indicators">
              {slides.map((_, index) => (
                <button
                  key={index}
                  className={`carousel-indicator ${index === currentSlide ? 'active' : ''}`}
                  onClick={() => goToSlide(index)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Show More/Less button */}
      <div className="insights-footer">
        <button
          className="expand-toggle-btn"
          onClick={() => setExpanded(!isExpanded)}
        >
          {isExpanded ? '▲ Show Summary' : '▼ Show Full Insights'}
        </button>
      </div>
    </div>
  );
}

// Helper component for rendering carousel in tabbed multi-domain view
function SingleDomainCarousel({ slides, currentSlide, setCurrentSlide, carouselRef, insights }) {
  const totalSlides = slides.length;

  const goToSlide = (index) => {
    const newIndex = Math.max(0, Math.min(index, totalSlides - 1));
    setCurrentSlide(newIndex);
    if (carouselRef.current) {
      const slideWidth = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: slideWidth * newIndex,
        behavior: 'smooth'
      });
    }
  };

  const nextSlide = () => {
    if (currentSlide < totalSlides - 1) {
      goToSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      goToSlide(currentSlide - 1);
    }
  };

  return (
    <div className="insights-body carousel-container">
      {totalSlides > 1 && (
        <>
          <button
            className="carousel-nav carousel-prev"
            onClick={prevSlide}
            disabled={currentSlide === 0}
            aria-label="Previous slide"
          >
            ‹
          </button>
          <button
            className="carousel-nav carousel-next"
            onClick={nextSlide}
            disabled={currentSlide === totalSlides - 1}
            aria-label="Next slide"
          >
            ›
          </button>
        </>
      )}

      <div className="carousel-track" ref={carouselRef}>
        {slides.map((slide, index) => (
          <div key={index} className="carousel-slide">
            {slide.type === 'actions' ? (
              <div className="recommended-actions">
                <h3 className="actions-title">
                  <span className="actions-icon">🎯</span>
                  Recommended Actions
                </h3>
                <div className="actions-list">
                  {slide.data.map((action, actionIndex) => (
                    <div key={actionIndex} className="action-item-compact">
                      <span className="action-category-compact">{action.category}</span>
                      <p className="action-text-compact">{action.action}</p>
                      <p className="action-rationale-compact">{action.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="theme-section">
                <h3 className="theme-title">
                  <span className="theme-icon">{slide.data.icon}</span>
                  {slide.data.name}
                </h3>

                <div className="insights-list">
                  {slide.data.insights.map((insight, insightIndex) => (
                    <div key={insightIndex} className="insight-item">
                      <p className="insight-text">{insight.text}</p>

                      {insight.articles && insight.articles.length > 0 && (
                        <div className="related-articles">
                          <span className="related-label">Related:</span>
                          <div className="article-chips">
                            {insight.articles.slice(0, 3).map((article, articleIndex) => (
                              <a
                                key={articleIndex}
                                href={article.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="article-chip"
                                title={article.title}
                              >
                                <span className="chip-source">{article.source}</span>
                              </a>
                            ))}
                            {insight.articles.length > 3 && (
                              <span className="chip-more">+{insight.articles.length - 3} more</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {slide.data.actions && slide.data.actions.length > 0 && (
                  <div className="theme-actions">
                    <h4 className="theme-actions-title">Actions:</h4>
                    <div className="theme-actions-list">
                      {slide.data.actions.map((action, actionIndex) => (
                        <div key={actionIndex} className="theme-action-item">
                          <span className="theme-action-icon">→</span>
                          <p className="theme-action-text">{action.action}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {totalSlides > 1 && (
        <div className="carousel-indicators">
          {slides.map((_, index) => (
            <button
              key={index}
              className={`carousel-indicator ${index === currentSlide ? 'active' : ''}`}
              onClick={() => goToSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {insights.fallback && (
        <div className="fallback-notice">
          Note: AI-powered insights are currently unavailable. Showing basic article grouping.
        </div>
      )}
    </div>
  );
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

function truncateTitle(title, maxLength = 40) {
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength) + '...';
}
