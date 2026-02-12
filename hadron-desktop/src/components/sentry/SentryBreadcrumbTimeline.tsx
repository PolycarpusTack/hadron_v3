/**
 * Sentry Breadcrumb Timeline
 * Displays the user's journey leading up to the error as a visual timeline
 */

import { AlertTriangle, Globe, Database, Terminal, MousePointer, Navigation } from "lucide-react";

interface Breadcrumb {
  timestamp?: string;
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, unknown>;
  breadcrumb_type?: string;
}

interface SentryBreadcrumbTimelineProps {
  breadcrumbs: Breadcrumb[];
  breadcrumbAnalysis?: string;
}

export default function SentryBreadcrumbTimeline({
  breadcrumbs,
  breadcrumbAnalysis,
}: SentryBreadcrumbTimelineProps) {
  const getLevelColor = (level?: string) => {
    switch (level) {
      case "error":
        return "text-red-400 bg-red-500/20 border-red-500/30";
      case "warning":
        return "text-yellow-400 bg-yellow-500/20 border-yellow-500/30";
      case "info":
        return "text-blue-400 bg-blue-500/20 border-blue-500/30";
      case "debug":
        return "text-gray-400 bg-gray-500/20 border-gray-500/30";
      default:
        return "text-gray-400 bg-gray-500/20 border-gray-500/30";
    }
  };

  const getCategoryIcon = (category?: string) => {
    if (!category) return <Terminal className="w-3.5 h-3.5" />;
    if (category.includes("http") || category.includes("fetch") || category.includes("xhr"))
      return <Globe className="w-3.5 h-3.5" />;
    if (category.includes("query") || category.includes("db") || category.includes("sql"))
      return <Database className="w-3.5 h-3.5" />;
    if (category.includes("ui") || category.includes("click") || category.includes("touch"))
      return <MousePointer className="w-3.5 h-3.5" />;
    if (category.includes("navigation") || category.includes("route"))
      return <Navigation className="w-3.5 h-3.5" />;
    if (category.includes("console"))
      return <Terminal className="w-3.5 h-3.5" />;
    return <Terminal className="w-3.5 h-3.5" />;
  };

  const formatTimestamp = (ts?: string) => {
    if (!ts) return "";
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      } as Intl.DateTimeFormatOptions);
    } catch {
      return ts;
    }
  };

  // Show last 30 breadcrumbs in chronological order
  const displayBreadcrumbs = breadcrumbs.slice(-30);

  return (
    <div className="space-y-4">
      {/* AI Breadcrumb Analysis */}
      {breadcrumbAnalysis && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-semibold text-blue-400">AI Breadcrumb Analysis</h4>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{breadcrumbAnalysis}</p>
        </div>
      )}

      {/* Timeline */}
      {displayBreadcrumbs.length > 0 ? (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gray-700" />

          <div className="space-y-1">
            {displayBreadcrumbs.map((bc, i) => {
              const isLast = i === displayBreadcrumbs.length - 1;
              return (
                <div key={i} className="relative flex items-start gap-3 pl-1">
                  {/* Dot */}
                  <div
                    className={`relative z-10 flex items-center justify-center w-[22px] h-[22px] rounded-full border flex-shrink-0 mt-0.5 ${
                      isLast
                        ? "bg-red-500/20 border-red-500/50 text-red-400"
                        : getLevelColor(bc.level)
                    }`}
                  >
                    {getCategoryIcon(bc.category)}
                  </div>

                  {/* Content */}
                  <div className={`flex-1 min-w-0 py-1 ${isLast ? "pb-0" : ""}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-gray-500">
                        {formatTimestamp(bc.timestamp)}
                      </span>
                      <span className="text-[10px] font-medium text-gray-400 px-1.5 py-0.5 bg-gray-800 rounded">
                        {bc.category || "default"}
                      </span>
                      {bc.level && bc.level !== "info" && (
                        <span
                          className={`text-[10px] font-medium px-1 py-0.5 rounded ${getLevelColor(
                            bc.level
                          )}`}
                        >
                          {bc.level}
                        </span>
                      )}
                    </div>
                    {bc.message && (
                      <p className="text-xs text-gray-300 mt-0.5 break-words font-mono">
                        {bc.message}
                      </p>
                    )}
                    {bc.data && Object.keys(bc.data).length > 0 && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-400">
                          data
                        </summary>
                        <pre className="text-[10px] text-gray-500 mt-1 overflow-x-auto max-w-full">
                          {JSON.stringify(bc.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <Terminal className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No breadcrumbs available</p>
          <p className="text-xs mt-1">Breadcrumbs show user actions leading up to the error</p>
        </div>
      )}
    </div>
  );
}
