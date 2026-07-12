/**
 * Date normalization for article ingest.
 *
 * pub_date is TEXT in SQLite and every comparison on it (24h window,
 * ORDER BY, 90-day cleanup) is lexicographic — so all stored dates must
 * be canonical UTC ISO-8601 for string order to equal chronological order.
 * This module is dependency-free on purpose: the data migration script and
 * the test suite import it without touching the DB or the fetchers.
 */

/**
 * Parse a date string and return canonical UTC ISO-8601, or null if the
 * input is missing, not a string, or unparseable.
 */
export function toUtcIso(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  const parsed = new Date(dateString.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Resolve an RSS item's publication date to UTC ISO-8601.
 * Prefers rss-parser's normalized isoDate, then a validated parse of the
 * raw pubDate; logs and falls back to now if neither parses.
 */
export function normalizePubDate(item, sourceName) {
  const iso = toUtcIso(item.isoDate) || toUtcIso(item.pubDate);
  if (iso) return iso;

  console.warn(
    `[RSS] ${sourceName}: unparseable date on "${item.title}" ` +
    `(isoDate=${item.isoDate ?? 'none'}, pubDate=${item.pubDate ?? 'none'}) — falling back to now`
  );
  return new Date().toISOString();
}
