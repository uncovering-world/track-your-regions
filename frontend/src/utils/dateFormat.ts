/**
 * Shared date formatting utilities
 */

/**
 * Format an ISO date string to a locale-aware date+time string.
 * Returns 'Never' for null/empty values.
 */
export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

/**
 * Format an ISO date string as a relative time (e.g., "5m ago", "2d ago").
 * Falls back to locale date after the given threshold (default 30 days).
 *
 * @param fallbackAfterMs - Switch to locale date after this many ms (default: 30 days)
 */
export function formatRelativeTime(
  dateStr: string,
  fallbackAfterMs: number = 30 * 24 * 60 * 60 * 1000,
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs >= fallbackAfterMs) return date.toLocaleDateString();

  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

/**
 * Format a duration between two ISO date strings as a human-readable string.
 * Returns '-' if end is null (still running).
 */
export function formatDuration(start: string, end: string | null): string {
  if (!end) return '-';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
