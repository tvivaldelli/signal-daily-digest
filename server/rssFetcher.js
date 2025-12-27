import Parser from 'rss-parser';
import { readFile } from 'fs/promises';
import { summarizeArticle } from './claudeSummarizer.js';
import { saveArticle } from './db.js';
import { decode } from 'html-entities';

const parser = new Parser({
  customFields: {
    item: [
      'description',
      'content:encoded',
      'summary',
      'media:thumbnail',
      'media:content',
      'media:group',
      'itunes:image'
    ]
  }
});

// Cached sources configuration (loaded once on first request)
let cachedSources = null;

/**
 * Simple concurrency limiter for parallel execution
 * @param {number} concurrency - Max parallel executions
 */
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        active--;
        runNext();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runNext();
  });
}

/**
 * Sleep helper for retry delays
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;

  // Match patterns like:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://www.youtube.com/shorts/VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Normalize YouTube thumbnail URL to use standard domain
 */
function normalizeYouTubeThumbnailUrl(url) {
  if (!url) return url;

  // Convert i1/i2/i3/i4.ytimg.com to img.youtube.com for reliability
  const match = url.match(/https?:\/\/i[1-4]\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\/([^\/]+\.jpg)/);
  if (match) {
    const videoId = match[1];
    const quality = match[2];
    return `https://img.youtube.com/vi/${videoId}/${quality}`;
  }

  return url;
}

/**
 * Extract image URL from RSS item with fallbacks
 */
function extractImageUrl(item) {
  let imageUrl = null;

  // Try media:group > media:thumbnail (YouTube format)
  if (item['media:group'] && item['media:group']['media:thumbnail']) {
    const thumbnail = item['media:group']['media:thumbnail'];
    if (Array.isArray(thumbnail) && thumbnail[0] && thumbnail[0].$) {
      imageUrl = thumbnail[0].$.url;
    } else if (thumbnail && thumbnail.$) {
      imageUrl = thumbnail.$.url;
    }
  }

  // Try media:thumbnail (YouTube, media RSS)
  if (!imageUrl && item['media:thumbnail'] && item['media:thumbnail'].$) {
    imageUrl = item['media:thumbnail'].$.url;
  }

  // Try media:content (alternative media RSS format)
  if (!imageUrl && item['media:content'] && item['media:content'].$) {
    imageUrl = item['media:content'].$.url;
  }

  // Try enclosure (standard RSS image)
  if (!imageUrl && item.enclosure && item.enclosure.url) {
    imageUrl = item.enclosure.url;
  }

  // Try itunes:image (podcast artwork)
  if (!imageUrl && item['itunes:image']) {
    if (typeof item['itunes:image'] === 'string') {
      imageUrl = item['itunes:image'];
    } else if (item['itunes:image'].$ && item['itunes:image'].$.href) {
      imageUrl = item['itunes:image'].$.href;
    }
  }

  // Fallback: Try to construct YouTube thumbnail from video ID
  if (!imageUrl && item.link) {
    const videoId = extractYouTubeVideoId(item.link);
    if (videoId) {
      imageUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }
  }

  // Normalize YouTube URLs to use standard domain
  if (imageUrl) {
    imageUrl = normalizeYouTubeThumbnailUrl(imageUrl);
  }

  return imageUrl;
}

/**
 * Load news sources from configuration (cached after first load)
 */
async function loadSources() {
  // Return cached sources if available
  if (cachedSources) {
    return cachedSources;
  }

  try {
    const data = await readFile('./sources.json', 'utf8');
    cachedSources = JSON.parse(data);
    console.log('[RSS] ✓ Sources loaded and cached');
    return cachedSources;
  } catch (error) {
    console.error('Error loading sources.json:', error);
    return { sources: [] };
  }
}

/**
 * Fetch RSS feed from a single source with retry logic
 * @param {Object} source - RSS source configuration
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 */
async function fetchRSS(source, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching RSS from ${source.name}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}...`);
      const feed = await parser.parseURL(source.rss);

      const articles = [];

      for (const item of feed.items.slice(0, 10)) { // Limit to 10 most recent items
        try {
          // Extract content
          const content = item['content:encoded'] || item.description || item.summary || '';

          // Use quick summary from content (no Claude to avoid timeouts)
          const cleanContent = decode(content.replace(/<[^>]*>/g, '')); // Remove HTML tags and decode entities
          const quickSummary = cleanContent
            .substring(0, 300)
            .trim() + '...';

          // Extract image URL from various possible sources
          const imageUrl = extractImageUrl(item);

          const article = {
            title: decode(item.title || ''), // Decode HTML entities in title
            link: item.link,
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            source: source.name,
            category: source.category || '',
            summary: quickSummary,
            originalContent: cleanContent.substring(0, 500), // Store first 500 chars
            imageUrl: imageUrl
          };

          // Save to database
          await saveArticle(article);
          articles.push(article);

          console.log(`✓ Saved: ${item.title}`);
        } catch (error) {
          console.error(`Error processing article "${item.title}":`, error.message);
        }
      }

      return articles;
    } catch (error) {
      lastError = error;
      console.error(`Error fetching RSS from ${source.name} (attempt ${attempt}/${maxRetries}):`, error.message);

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`  Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  console.error(`Failed to fetch RSS from ${source.name} after ${maxRetries} attempts`);
  return [];
}

/**
 * Fetch all RSS feeds from configured sources (parallel with concurrency limit)
 */
export async function fetchAllFeeds() {
  const config = await loadSources();
  const startTime = Date.now();

  console.log(`\nFetching from ${config.sources.length} sources (parallel, max 5 concurrent)...`);

  // Use concurrency limiter to fetch up to 5 feeds in parallel
  const limit = createLimiter(5);
  const results = await Promise.all(
    config.sources.map(source => limit(() => fetchRSS(source)))
  );

  const allArticles = results.flat();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✓ Total articles fetched: ${allArticles.length} in ${elapsed}s\n`);
  return allArticles;
}

/**
 * Get list of configured sources
 */
export async function getSources() {
  const config = await loadSources();
  return config.sources;
}
