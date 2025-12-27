import { forwardRef } from 'react';

/**
 * Reusable carousel component for insights display
 * Consolidates duplicated carousel rendering logic
 */
const CarouselSlides = forwardRef(function CarouselSlides({
  slides,
  currentSlide,
  onSlideChange,
  showFallback = false
}, ref) {
  const totalSlides = slides.length;

  const goToSlide = (index) => {
    const newIndex = Math.max(0, Math.min(index, totalSlides - 1));
    onSlideChange(newIndex);
    if (ref?.current) {
      const slideWidth = ref.current.offsetWidth;
      ref.current.scrollTo({
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

      <div className="carousel-track" ref={ref}>
        {slides.map((slide, index) => (
          <div key={index} className="carousel-slide">
            {slide.type === 'actions' ? (
              <ActionsSlide actions={slide.data} />
            ) : (
              <ThemeSlide theme={slide.data} />
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

      {showFallback && (
        <div className="fallback-notice">
          Note: AI-powered insights are currently unavailable. Showing basic article grouping.
        </div>
      )}
    </div>
  );
});

/**
 * Slide component for recommended actions
 */
function ActionsSlide({ actions }) {
  return (
    <div className="recommended-actions">
      <h3 className="actions-title">
        <span className="actions-icon">🎯</span>
        Recommended Actions
      </h3>
      <div className="actions-list">
        {actions.map((action, index) => (
          <div key={index} className="action-item-compact">
            <span className="action-category-compact">{action.category}</span>
            <p className="action-text-compact">{action.action}</p>
            <p className="action-rationale-compact">{action.rationale}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Slide component for theme insights
 */
function ThemeSlide({ theme }) {
  return (
    <div className="theme-section">
      <h3 className="theme-title">
        <span className="theme-icon">{theme.icon}</span>
        {theme.name}
      </h3>

      <div className="insights-list">
        {theme.insights.map((insight, index) => (
          <div key={index} className="insight-item">
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

      {theme.actions && theme.actions.length > 0 && (
        <div className="theme-actions">
          <h4 className="theme-actions-title">Actions:</h4>
          <div className="theme-actions-list">
            {theme.actions.map((action, index) => (
              <div key={index} className="theme-action-item">
                <span className="theme-action-icon">→</span>
                <p className="theme-action-text">{action.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Helper to build slides array from insights data
 */
export function buildSlides(insights) {
  const slides = [];
  if (insights?.recommendedActions?.length > 0) {
    slides.push({ type: 'actions', data: insights.recommendedActions });
  }
  if (insights?.themes) {
    insights.themes.forEach(theme => {
      slides.push({ type: 'theme', data: theme });
    });
  }
  return slides;
}

export default CarouselSlides;
