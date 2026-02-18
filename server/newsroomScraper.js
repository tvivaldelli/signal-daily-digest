import * as cheerio from 'cheerio';

/**
 * Common fetch + cheerio load + error handling wrapper
 * @param {string} url - URL to fetch
 * @param {Function} parser - Site-specific parser function receiving cheerio $
 * @param {string} sourceName - Source name for article objects
 * @param {number} maxItems - Maximum items to return
 * @returns {Promise<Array>} Articles array
 */
async function scrapeNewsroom(url, parser, sourceName, maxItems = 10) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MortgageIntelBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[Scraper] ${sourceName}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const articles = parser($, maxItems);

    console.log(`[Scraper] ${sourceName}: found ${articles.length} articles`);
    return articles.map(article => ({
      ...article,
      source: sourceName,
      category: 'competitor-intel',
    }));
  } catch (error) {
    console.error(`[Scraper] ${sourceName} failed:`, error.message);
    return [];
  }
}

/**
 * Scrape Rocket Companies press releases
 * Covers both Rocket Mortgage and Mr. Cooper (post-acquisition)
 */
export async function scrapeRocketPressReleases(maxItems = 10) {
  return scrapeNewsroom(
    'https://rocketcompanies.com/press-releases/',
    ($, max) => {
      const articles = [];

      // Rocket press releases page typically has a list of press release links
      $('a[href*="/press-release/"]').each((i, el) => {
        if (articles.length >= max) return false;

        const $el = $(el);
        const title = $el.text().trim();
        const href = $el.attr('href');

        if (!title || !href || title.length < 10) return;

        // Skip duplicate titles
        if (articles.some(a => a.title === title)) return;

        const link = href.startsWith('http') ? href : `https://rocketcompanies.com${href}`;

        // Try to find a date near this element
        const $parent = $el.closest('li, div, article');
        const dateText = $parent.find('time, [datetime], .date, .press-release-date').first().text().trim();
        const pubDate = dateText ? new Date(dateText).toISOString() : new Date().toISOString();

        articles.push({
          title,
          link,
          pubDate,
          summary: '',
          originalContent: '',
          imageUrl: null,
          contentHtml: null,
          hasFullContent: false,
        });
      });

      return articles;
    },
    'Rocket Companies Newsroom',
    maxItems
  );
}

/**
 * Scrape Blend newsroom (card-based layout)
 * Extracts headlines and external links (often Business Wire)
 */
export async function scrapeBlendNewsroom(maxItems = 10) {
  return scrapeNewsroom(
    'https://blend.com/company/newsroom/',
    ($, max) => {
      const articles = [];

      // Blend newsroom uses card-based layout with headlines and links
      $('a[href]').each((i, el) => {
        if (articles.length >= max) return false;

        const $el = $(el);
        const href = $el.attr('href') || '';

        // Look for external press links (businesswire, prnewswire, etc) or blog posts
        const isNewsLink = href.includes('businesswire.com') ||
          href.includes('prnewswire.com') ||
          href.includes('globenewswire.com') ||
          (href.includes('blend.com') && href.includes('/blog/'));

        if (!isNewsLink) return;

        // Get the card/container text as title
        const $card = $el.closest('div, article, li');
        let title = $el.find('h2, h3, h4').first().text().trim() ||
          $card.find('h2, h3, h4').first().text().trim() ||
          $el.text().trim();

        if (!title || title.length < 10) return;
        // Truncate very long titles
        if (title.length > 200) title = title.substring(0, 200);

        // Skip duplicates
        if (articles.some(a => a.title === title || a.link === href)) return;

        articles.push({
          title,
          link: href,
          pubDate: new Date().toISOString(), // Dates not visible in cards
          summary: '',
          originalContent: '',
          imageUrl: null,
          contentHtml: null,
          hasFullContent: false,
        });
      });

      return articles;
    },
    'Blend Newsroom',
    maxItems
  );
}

/**
 * Scrape ICE Mortgage Technology press releases
 * Parses table layout, filters to "Mortgage Technology" category only
 */
export async function scrapeICEMortgageTech(maxItems = 10) {
  return scrapeNewsroom(
    'https://www.ice.com/media',
    ($, max) => {
      const articles = [];

      // ICE media page has a table with Date, Title, Category columns
      $('table tr, .press-release-row, [class*="press"]').each((i, el) => {
        if (articles.length >= max) return false;

        const $row = $(el);
        const cells = $row.find('td');

        if (cells.length < 2) return;

        // Try to identify category column and filter for Mortgage Technology
        const rowText = $row.text().toLowerCase();
        if (!rowText.includes('mortgage') && !rowText.includes('ice mortgage technology')) return;

        // Extract title and link
        const $link = $row.find('a').first();
        const title = $link.text().trim() || cells.eq(1).text().trim();
        const href = $link.attr('href');

        if (!title || title.length < 10) return;

        const link = href ?
          (href.startsWith('http') ? href : `https://www.ice.com${href}`) :
          '';

        // Extract date from first column
        const dateText = cells.first().text().trim();
        const pubDate = dateText ? new Date(dateText).toISOString() : new Date().toISOString();

        // Skip duplicates
        if (articles.some(a => a.title === title)) return;

        articles.push({
          title,
          link,
          pubDate,
          summary: '',
          originalContent: '',
          imageUrl: null,
          contentHtml: null,
          hasFullContent: false,
        });
      });

      return articles;
    },
    'ICE Mortgage Technology',
    maxItems
  );
}
