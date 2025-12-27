/**
 * Shared formatting utilities
 * Consolidates duplicated formatting logic across components
 */

/**
 * Calculate time ago from a date string
 * @param {string} dateString - ISO date string
 * @returns {string} Human-readable time ago (e.g., "2 hours ago", "Yesterday")
 */
export function getTimeAgo(dateString) {
  if (!dateString) return null;

  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 0) {
    if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffMins > 0) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    }
    return 'just now';
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
}

/**
 * Format a date for display
 * @param {string} dateString - ISO date string
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
export function formatDate(dateString, options = {}) {
  const date = new Date(dateString);
  const defaultOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options
  };
  return date.toLocaleDateString('en-US', defaultOptions);
}

/**
 * Format a date with time
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date with time (e.g., "Dec 27, 2025, 2:30 PM")
 */
export function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format a full date (e.g., "December 27, 2025")
 * @param {string} dateString - ISO date string
 * @returns {string} Full formatted date
 */
export function formatFullDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Today's date string
 */
export function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Format category name for display (e.g., "product-management" -> "Product Management")
 * @param {string} category - Category slug
 * @returns {string} Formatted category name
 */
export function formatCategoryName(category) {
  if (!category) return '';
  return category.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

/**
 * Truncate text to a maximum length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}
