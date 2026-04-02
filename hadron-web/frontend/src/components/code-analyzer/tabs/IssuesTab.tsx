import { useState, useEffect, useRef } from "react";
import type { CodeIssue } from "../../../services/api";
import { SeverityBadge } from "../shared/SeverityBadge";
import { CategoryBadge } from "../shared/CategoryBadge";

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function IssuesTab({
  issues,
  highlightIssueId,
  externalSeverityFilter,
}: {
  issues: CodeIssue[];
  highlightIssueId?: number;
  externalSeverityFilter?: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(
    new Set(highlightIssueId != null ? [highlightIssueId] : []),
  );
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
    requestAnimationFrame(() => {
      issueRefs.current[highlightIssueId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
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

  const sortedIssues = [...filteredIssues].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Severity:</span>
          <select
            value={severityFilter || ""}
            onChange={(e) => setSeverityFilter(e.target.value || null)}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-sm text-slate-200"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Category:</span>
          <select
            value={categoryFilter || ""}
            onChange={(e) => setCategoryFilter(e.target.value || null)}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-sm text-slate-200"
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
          ref={(el) => {
            issueRefs.current[issue.id] = el;
          }}
          className="overflow-hidden rounded-lg border border-slate-700"
        >
          {/* Issue header */}
          <div
            onClick={() => toggleIssue(issue.id)}
            className={`flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-slate-700/50 ${
              issue.severity === "critical"
                ? "bg-red-900/20"
                : issue.severity === "high"
                  ? "bg-orange-900/20"
                  : "bg-slate-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-200">{issue.title}</span>
                  <SeverityBadge severity={issue.severity} />
                  <CategoryBadge category={issue.category} />
                </div>
                <p className="text-sm text-slate-400">Line {issue.line}</p>
              </div>
            </div>
            <span className="text-slate-400">{expanded.has(issue.id) ? "−" : "+"}</span>
          </div>

          {/* Issue body */}
          {expanded.has(issue.id) && (
            <div className="space-y-4 border-t border-slate-700 bg-slate-800 p-4">
              {/* What's Wrong */}
              <div className="rounded-lg border border-violet-800 bg-violet-900/20 p-4">
                <h4 className="mb-2 font-medium text-violet-300">What's Wrong</h4>
                <p className="text-sm text-slate-300">{issue.description}</p>
              </div>

              {/* Technical Details */}
              <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-4">
                <h4 className="mb-2 font-medium text-slate-200">Technical Details</h4>
                <p className="font-mono text-sm text-slate-400">{issue.technical}</p>
              </div>

              {/* Suggested Fix */}
              <div className="rounded-lg border border-green-800 bg-green-900/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-medium text-green-300">Suggested Fix</h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyFix(issue);
                    }}
                    className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300"
                  >
                    {copied === issue.id ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded bg-green-900/30 p-3 font-mono text-sm text-green-300">
                  {issue.fix}
                </pre>
              </div>

              {/* Complexity & Impact */}
              <div className="flex gap-4">
                <div className="flex-1 rounded-lg border border-blue-800 bg-blue-900/20 p-3">
                  <span className="text-xs text-blue-400">Complexity</span>
                  <p className="font-medium text-blue-300">{issue.complexity}</p>
                </div>
                {issue.impact && (
                  <div className="flex-1 rounded-lg border border-orange-800 bg-orange-900/20 p-3">
                    <span className="text-xs text-orange-400">Real-World Impact</span>
                    <p className="font-medium text-orange-300">{issue.impact}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {sortedIssues.length === 0 && (
        <div className="py-8 text-center text-slate-400">
          {severityFilter || categoryFilter
            ? "No issues match the current filters."
            : "No issues found."}
        </div>
      )}
    </div>
  );
}
