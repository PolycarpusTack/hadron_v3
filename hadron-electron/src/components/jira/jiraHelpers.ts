/**
 * Shared helpers for JIRA Analyzer components
 */

export function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("done") || lower.includes("resolved") || lower.includes("closed")) {
    return "bg-green-500/20 text-green-400";
  }
  if (lower.includes("progress") || lower.includes("review")) {
    return "bg-blue-500/20 text-blue-400";
  }
  if (lower.includes("blocked") || lower.includes("hold")) {
    return "bg-red-500/20 text-red-400";
  }
  return "bg-gray-500/20 text-gray-400";
}

export function getPriorityColor(priority: string): string {
  const lower = priority.toLowerCase();
  if (lower === "highest" || lower === "critical") return "text-red-400";
  if (lower === "high") return "text-orange-400";
  if (lower === "medium") return "text-yellow-400";
  if (lower === "low") return "text-blue-400";
  if (lower === "lowest") return "text-gray-400";
  return "text-gray-400";
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Storage key for watched project configurations */
const WATCHED_PROJECTS_KEY = "jira_watched_projects";

export interface WatchedProject {
  key: string;
  name: string;
  statuses: string[];
}

export function getWatchedProjects(): WatchedProject[] {
  try {
    const raw = localStorage.getItem(WATCHED_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWatchedProjects(projects: WatchedProject[]): void {
  localStorage.setItem(WATCHED_PROJECTS_KEY, JSON.stringify(projects.slice(0, 5)));
}
