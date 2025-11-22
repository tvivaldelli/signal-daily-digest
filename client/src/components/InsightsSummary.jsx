import { useState, useEffect, useRef } from 'react';
import './InsightsSummary.css';

export default function InsightsSummary({ insights, loading, error }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const carouselRef = useRef(null);

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isExpanded) return;
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === 'ArrowRight') nextSlide();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, currentSlide, totalSlides]);

  return (
    <div className="insights-summary carousel-layout">
      <div className="insights-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="header-content">
          <h2>Key Insights</h2>
          <span className="insights-meta">
            {insights.themes.length} theme{insights.themes.length > 1 ? 's' : ''} • {insights.articleCount} articles analyzed
          </span>
        </div>
        <button className="toggle-button" aria-label={isExpanded ? "Collapse" : "Expand"}>
          {isExpanded ? '−' : '+'}
        </button>
      </div>

      {isExpanded && (
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
                          <p className="action-rationale-compact">{truncateText(action.rationale, 100)}</p>
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
                          <p className="insight-text">{truncateText(insight.text, 150)}</p>

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
                              <p className="theme-action-text">{truncateText(action.action, 120)}</p>
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
