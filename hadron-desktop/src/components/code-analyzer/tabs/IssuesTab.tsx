import { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
} from "lucide-react";
import type { CodeIssue } from "../../../types";
import SeverityBadge from "../shared/SeverityBadge";
import CategoryBadge from "../shared/CategoryBadge";

export default function IssuesTab({
  issues,
  highlightIssueId,
  externalSeverityFilter,
}: {
  issues: CodeIssue[];
  highlightIssueId?: number;
  externalSeverityFilter?: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set(highlightIssueId ? [highlightIssueId] : []));
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const issueRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external severity filter driven from Quality tab
  useEffect(() => {
    if (externalSeverityFilter != null) {
      setSeverityFilter(externalSeverityFilter);
    }
  }, [externalSeverityFilter]);

  // Respond to programmatic navigation (e.g. clicking a critical issue in Overview)
  useEffect(() => {
    if (highlightIssueId === undefined) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(highlightIssueId);
      return next;
    });
    // Scroll the issue into view after state settles
    requestAnimationFrame(() => {
      issueRefs.current[highlightIssueId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [highlightIssueId]);

  const toggleIssue = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyFix = (issue: CodeIssue) => {
    navigator.clipboard.writeText(issue.fix);
    setCopied(issue.id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(null), 2000);
  };

  const filteredIssues = issues.filter((issue) => {
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (categoryFilter && issue.category !== categoryFilter) return false;
    return true;
  });

  // Sort by severity — nullish fallback prevents NaN if AI returns an unexpected value
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedIssues = [...filteredIssues].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Severity:</span>
          <select
            value={severityFilter || ""}
            onChange={(e) => setSeverityFilter(e.target.value || null)}
            className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Category:</span>
          <select
            value={categoryFilter || ""}
            onChange={(e) => setCategoryFilter(e.target.value || null)}
            className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
          >
            <option value="">All</option>
            <option value="security">Security</option>
            <option value="performance">Performance</option>
            <option value="error">Error</option>
            <option value="best-practice">Best Practice</option>
          </select>
        </div>
      </div>

      {/* Issues */}
      {sortedIssues.map((issue) => (
        <div
          key={issue.id}
          ref={(el) => { issueRefs.current[issue.id] = el; }}
          className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
        >
          <div
            onClick={() => toggleIssue(issue.id)}
            className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between ${
              issue.severity === "critical"
                ? "bg-red-50 dark:bg-red-900/20"
                : issue.severity === "high"
                ? "bg-orange-50 dark:bg-orange-900/20"
                : "bg-white dark:bg-gray-800"
            }`}
          >
            <div className="flex items-center gap-3">
              {issue.severity === "critical" ? (
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              )}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{issue.title}</span>
                  <SeverityBadge severity={issue.severity} />
                  <CategoryBadge category={issue.category} />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Line {issue.line}</p>
              </div>
            </div>
            {expanded.has(issue.id) ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
          </div>

          {expanded.has(issue.id) && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-4">
              {/* Description */}
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4">
                <h4 className="font-medium text-violet-800 dark:text-violet-300 mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  What's Wrong
                </h4>
                <p className="text-gray-700 dark:text-gray-300">{issue.description}</p>
              </div>

              {/* Technical Details */}
              <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Technical Details</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm font-mono">{issue.technical}</p>
              </div>

              {/* Suggested Fix */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-green-800 dark:text-green-300 flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Suggested Fix
                  </h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyFix(issue);
                    }}
                    className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                  >
                    {copied === issue.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === issue.id ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="text-sm text-green-800 dark:text-green-300 font-mono bg-green-100 dark:bg-green-900/30 p-3 rounded overflow-x-auto">
                  {issue.fix}
                </pre>
              </div>

              {/* Complexity & Impact */}
              <div className="flex gap-4">
                <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <span className="text-xs text-blue-600 dark:text-blue-400">Complexity</span>
                  <p className="font-medium text-blue-800 dark:text-blue-300">{issue.complexity}</p>
                </div>
                {issue.impact && (
                  <div className="flex-1 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                    <span className="text-xs text-orange-600 dark:text-orange-400">Real-World Impact</span>
                    <p className="font-medium text-orange-800 dark:text-orange-300">{issue.impact}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {sortedIssues.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {severityFilter || categoryFilter ? "No issues match the current filters." : "No issues found."}
        </div>
      )}
    </div>
  );
}
