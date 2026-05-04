/**
 * TriageBadgePanel
 * Displays the AI triage result as a compact badge row below the ticket card.
 * Used in JiraTicketAnalyzer after triage runs, or when loaded from DB on fetch.
 */

import { ShieldAlert, Tag, Users, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { JiraTriageResult } from "../../services/jira-assist";
import { SEVERITY_BADGE, CATEGORY_COLORS, CONFIDENCE_COLOR } from "../../services/jira-assist";

interface TriageBadgePanelProps {
  result: JiraTriageResult;
  /** When true shows a subtle "loaded from DB" label */
  fromCache?: boolean;
}

export default function TriageBadgePanel({ result, fromCache }: TriageBadgePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const severityClass = SEVERITY_BADGE[result.severity] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const categoryClass = CATEGORY_COLORS[result.category] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const confidenceClass = CONFIDENCE_COLOR[result.confidence] ?? "text-gray-400";

  return (
    <div className="bg-gray-800/60 rounded-lg border border-gray-700 overflow-hidden">
      {/* Compact badge row */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Header label */}
        <div className="flex items-center gap-1.5 mr-1">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
            Triage
          </span>
          {fromCache && (
            <span className="text-xs text-gray-600 italic">· saved</span>
          )}
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
            <Tag className="w-3 h-3 text-gray-500" />
            {result.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-gray-500 hover:text-gray-300 transition"
          title={expanded ? "Collapse triage details" : "Expand triage details"}
        >
          {expanded
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700 space-y-3">
          {/* Customer impact */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Customer Impact
              </span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">
              {result.customer_impact}
            </p>
          </div>

          {/* Rationale + confidence */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Brain className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Rationale
              </span>
              <span className={`text-xs ml-auto ${confidenceClass}`}>
                {result.confidence} confidence
              </span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed italic">
              {result.rationale}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
