import { format } from 'date-fns';
import './ArticleCard.css';

export default function ArticleCard({ article }) {
  const formattedDate = format(new Date(article.pubDate), 'MMM dd, yyyy');

  // Normalize YouTube thumbnail URLs to use more reliable domain
  const normalizeYouTubeThumbnail = (url) => {
    if (!url) return url;
    // Convert i1-i4.ytimg.com to img.youtube.com
    const match = url.match(/https?:\/\/i[1-4]\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\/([^/]+\.jpg)/);
    if (match) {
      return `https://img.youtube.com/vi/${match[1]}/${match[2]}`;
    }
    return url;
  };

  // Handle image load error by trying normalized URL
  const handleImageError = (e) => {
    const img = e.target;
    const originalUrl = img.src;
    const normalizedUrl = normalizeYouTubeThumbnail(originalUrl);

    // If we haven't tried the normalized URL yet, try it
    if (normalizedUrl !== originalUrl && !img.dataset.retried) {
      img.dataset.retried = 'true';
      img.src = normalizedUrl;
    } else {
      // Hide the image container if both attempts fail
      img.parentElement.style.display = 'none';
    }
  };

  return (
    <div className="article-card">
      <div className="article-header">
        <span className="article-source">{article.source}</span>
        <span className="article-date">{formattedDate}</span>
      </div>

      {article.imageUrl && (
        <div className="article-image-container">
          <img
            src={article.imageUrl}
            alt={article.title}
            className="article-image"
            loading="lazy"
            onError={handleImageError}
          />
        </div>
      )}

      <h3 className="article-title">
        <a href={article.link} target="_blank" rel="noopener noreferrer">
          {article.title}
        </a>
      </h3>

      <p className="article-summary">{article.summary}</p>

      <a
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        className="read-more"
      >
        Read Full Article →
      </a>
    </div>
  );
}
