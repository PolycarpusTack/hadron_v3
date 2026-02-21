/**
 * Canonical severity color utilities.
 *
 * Replaces 10+ local definitions scattered across components.
 */

/**
 * Full badge classes: background + text + border.
 * Use for severity badges, tags, and pills.
 */
export function getSeverityBadgeClasses(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "high":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "low":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "info":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

/**
 * Text color only.
 * Use where only the severity text color is needed (inline text, icons).
 */
export function getSeverityTextColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "text-red-500";
    case "high":
      return "text-orange-400";
    case "medium":
      return "text-yellow-400";
    case "low":
      return "text-blue-400";
    case "info":
      return "text-emerald-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Background + border classes (no text color).
 * Use where text color is set separately or inherited.
 */
export function getSeverityBgClasses(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500/20 border-red-500/30";
    case "high":
      return "bg-orange-500/20 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/20 border-yellow-500/30";
    case "low":
      return "bg-blue-500/20 border-blue-500/30";
    case "info":
      return "bg-emerald-500/20 border-emerald-500/30";
    default:
      return "bg-gray-500/20 border-gray-500/30";
  }
}

/**
 * Solid background color for charts and progress bars.
 */
export function getSeverityBarColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "medium":
      return "bg-yellow-500";
    case "low":
      return "bg-blue-500";
    case "info":
      return "bg-emerald-500";
    default:
      return "bg-gray-500";
  }
}
