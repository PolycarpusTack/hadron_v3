/**
 * TriageBadgePanel
 * Displays the AI triage result as a compact badge row.
 * Used in JiraAnalyzerView after triage runs, or when loaded from DB on fetch.
 */

import { useState } from "react";
import type { JiraTriageResult } from "../../services/api";

interface TriageBadgePanelProps {
  result: JiraTriageResult;
}

const SEVERITY_BADGE: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-400 border-red-500/30",
  High: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const CATEGORY_COLORS: Record<string, string> = {
  Bug: "bg-red-500/20 text-red-400 border-red-500/30",
  Feature: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Infrastructure: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  UX: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  Performance: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Security: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  High: "text-green-400",
  Medium: "text-yellow-400",
  Low: "text-red-400",
};

/** Inline SVG: shield with exclamation (ShieldAlert) */
function IconShieldAlert({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Inline SVG: tag */
function IconTag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

/** Inline SVG: users */
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Inline SVG: brain */
function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z" />
    </svg>
  );
}

/** Inline SVG: chevron down */
function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Inline SVG: chevron up */
function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export default function TriageBadgePanel({ result }: TriageBadgePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const severityClass =
    SEVERITY_BADGE[result.severity] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";
  const categoryClass =
    CATEGORY_COLORS[result.category] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";
  const confidenceClass = CONFIDENCE_COLOR[result.confidence] ?? "text-slate-400";

  return (
    <div className="bg-slate-800/60 rounded-lg border border-slate-700 overflow-hidden">
      {/* Compact badge row */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Header label */}
        <div className="flex items-center gap-1.5 mr-1">
          <IconShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
            Triage
          </span>
        </div>

        {/* Severity badge */}
        <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${severityClass}`}>
          {result.severity}
        </span>

        {/* Category badge */}
        <span className={`text-xs px-2 py-0.5 rounded border ${categoryClass}`}>
          {result.category}
        </span>

        {/* Tags */}
        {result.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <IconTag className="w-3 h-3 text-slate-500" />
            {result.tags.map((tag) => (
              <span
                key={tag}
                className="bg-slate-700 text-slate-300 text-xs rounded px-1.5 py-0.5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
          title={expanded ? "Collapse triage details" : "Expand triage details"}
        >
          {expanded ? (
            <IconChevronUp className="w-4 h-4" />
          ) : (
            <IconChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-700 space-y-3">
          {/* Customer impact */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <IconUsers className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Customer Impact
              </span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {result.customer_impact}
            </p>
          </div>

          {/* Rationale + confidence */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <IconBrain className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Rationale
              </span>
              <span className={`text-xs ml-auto ${confidenceClass}`}>
                {result.confidence} confidence
              </span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed italic">
              {result.rationale}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
