import Parser from 'rss-parser';
import { readFile } from 'fs/promises';
import { saveArticle } from './db.js';
import { decode } from 'html-entities';
import { scrapeRocketPressReleases, scrapeBlendNewsroom, scrapeICEMortgageTech } from './newsroomScraper.js';

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

let cachedSources = null;

/**
 * Simple concurrency limiter for parallel execution
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Normalize YouTube thumbnail URL
 */
function normalizeYouTubeThumbnailUrl(url) {
  if (!url) return url;
  const match = url.match(/https?:\/\/i[1-4]\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\/([^\/]+\.jpg)/);
  if (match) {
    return `https://img.youtube.com/vi/${match[1]}/${match[2]}`;
  }
  return url;
}

/**
 * Extract image URL from RSS item with fallbacks
 */
function extractImageUrl(item) {
  let imageUrl = null;

  if (item['media:group'] && item['media:group']['media:thumbnail']) {
    const thumbnail = item['media:group']['media:thumbnail'];
    if (Array.isArray(thumbnail) && thumbnail[0] && thumbnail[0].$) {
      imageUrl = thumbnail[0].$.url;
    } else if (thumbnail && thumbnail.$) {
      imageUrl = thumbnail.$.url;
    }
  }

  if (!imageUrl && item['media:thumbnail'] && item['media:thumbnail'].$) {
    imageUrl = item['media:thumbnail'].$.url;
  }

  if (!imageUrl && item['media:content'] && item['media:content'].$) {
    imageUrl = item['media:content'].$.url;
  }

  if (!imageUrl && item.enclosure && item.enclosure.url) {
    imageUrl = item.enclosure.url;
  }

  if (!imageUrl && item['itunes:image']) {
    if (typeof item['itunes:image'] === 'string') {
      imageUrl = item['itunes:image'];
    } else if (item['itunes:image'].$ && item['itunes:image'].$.href) {
      imageUrl = item['itunes:image'].$.href;
    }
  }

  if (!imageUrl && item.link) {
    const videoId = extractYouTubeVideoId(item.link);
    if (videoId) {
      imageUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }
  }

  if (imageUrl) {
    imageUrl = normalizeYouTubeThumbnailUrl(imageUrl);
  }

  return imageUrl;
}

/**
 * Load news sources from configuration (cached after first load)
 */
async function loadSources() {
  if (cachedSources) return cachedSources;
  try {
    const data = await readFile('./sources.json', 'utf8');
    cachedSources = JSON.parse(data);
    console.log('[RSS] Sources loaded and cached');
    return cachedSources;
  } catch (error) {
    console.error('Error loading sources.json:', error);
    return { sources: [] };
  }
}

/**
 * Fetch RSS feed from a single source with retry logic
 */
async function fetchRSS(source, maxRetries = 3) {
  let lastError = null;
  const isYouTube = source.rss?.includes('youtube.com/feeds/');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching RSS from ${source.name}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}...`);
      const feed = await parser.parseURL(source.rss);

      const articles = [];

      for (const item of feed.items.slice(0, 10)) {
        try {
          const content = item['content:encoded'] || item.description || item.summary || '';
          const cleanContent = decode(content.replace(/<[^>]*>/g, ''));
          const quickSummary = isYouTube ? '' : cleanContent.substring(0, 300).trim() + '...';

          const imageUrl = extractImageUrl(item);

          const article = {
            title: decode(item.title || ''),
            link: item.link,
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            source: source.name,
            category: source.category || '',
            type: isYouTube ? 'youtube' : 'article',
            summary: quickSummary,
            originalContent: isYouTube ? '' : cleanContent.substring(0, 500),
            imageUrl: imageUrl
          };

          await saveArticle(article);
          articles.push(article);

          console.log(`  Saved: ${item.title}`);
        } catch (error) {
          console.error(`Error processing article "${item.title}":`, error.message);
        }
      }

      return articles;
    } catch (error) {
      lastError = error;
      console.error(`Error fetching RSS from ${source.name} (attempt ${attempt}/${maxRetries}):`, error.message);

      if (attempt < maxRetries) {
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
 * Fetch YouTube video description from the video page
 */
async function fetchYouTubeDescription(videoUrl) {
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) return null;

  try {
    const resp = await fetch('https://www.youtube.com/watch?v=' + videoId, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+634'
      }
    });
    const html = await resp.text();

    const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s);
    if (!prMatch) return null;

    const pr = JSON.parse(prMatch[1]);
    const description = pr.videoDetails?.shortDescription || '';

    if (description.length > 0) {
      console.log(`[YT] Description fetched for ${videoId} (${description.split(/\s+/).length} words)`);
    }
    return description || null;
  } catch (error) {
    console.log(`[YT] No description available for ${videoId}: ${error.message}`);
    return null;
  }
}

/**
 * Enrich YouTube articles with video descriptions (parallel, with timeout)
 */
async function enrichYouTubeArticles(articles) {
  const youtubeArticles = articles.filter(a => a.type === 'youtube' && a.link);
  if (youtubeArticles.length === 0) return;

  console.log(`\n[YT] Fetching descriptions for ${youtubeArticles.length} YouTube video(s)...`);

  const results = await Promise.allSettled(
    youtubeArticles.map(async (article) => {
      // 10-second timeout per video
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Description fetch timed out')), 10000)
      );
      const description = await Promise.race([
        fetchYouTubeDescription(article.link),
        timeout
      ]);

      if (description) {
        article.summary = description.substring(0, 300).trim() + '...';
        article.originalContent = description.substring(0, 5000);
        await saveArticle(article);
        return true;
      }
      return false;
    })
  );

  const enriched = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`[YT] Enriched ${enriched}/${youtubeArticles.length} videos with descriptions`);
}

/**
 * Fetch all RSS feeds + run newsroom scrapers
 */
export async function fetchAllFeeds() {
  const config = await loadSources();
  const startTime = Date.now();

  console.log(`\nFetching from ${config.sources.length} RSS sources + 3 scrapers (parallel, max 5 concurrent)...`);

  // Fetch RSS feeds with concurrency limiter
  const limit = createLimiter(5);
  const rssResults = await Promise.all(
    config.sources.map(source => limit(() => fetchRSS(source)))
  );

  // Run all 3 newsroom scrapers in parallel
  const [rocketArticles, blendArticles, iceArticles] = await Promise.all([
    scrapeRocketPressReleases(10),
    scrapeBlendNewsroom(10),
    scrapeICEMortgageTech(10)
  ]);

  // Save scraped articles to DB
  const scraperArticles = [...rocketArticles, ...blendArticles, ...iceArticles];
  for (const article of scraperArticles) {
    try {
      await saveArticle(article);
    } catch (error) {
      console.error(`Error saving scraped article "${article.title}":`, error.message);
    }
  }

  const allArticles = [...rssResults.flat(), ...scraperArticles];

  // Enrich YouTube articles with video descriptions
  await enrichYouTubeArticles(allArticles);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nTotal articles fetched: ${allArticles.length} (${rssResults.flat().length} RSS + ${scraperArticles.length} scraped) in ${elapsed}s\n`);
  return allArticles;
}

/**
 * Get list of configured sources
 */
export async function getSources() {
  const config = await loadSources();
  return config.sources;
}
