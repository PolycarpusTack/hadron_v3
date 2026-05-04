/**
 * Sentry UI helpers
 * Shared formatting and color utilities for Sentry components
 */

export function getLevelColor(level: string): string {
  switch (level) {
    case "fatal":
      return "bg-red-600 text-white";
    case "error":
      return "bg-red-500/20 text-red-400";
    case "warning":
      return "bg-yellow-500/20 text-yellow-400";
    case "info":
      return "bg-blue-500/20 text-blue-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "unresolved":
      return "bg-orange-500/20 text-orange-400";
    case "resolved":
      return "bg-green-500/20 text-green-400";
    case "ignored":
      return "bg-gray-500/20 text-gray-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

export function formatCount(count: string): string {
  const n = parseInt(count, 10);
  if (isNaN(n)) return count;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
