/**
 * JiraAnalysisReport
 * Renders a structured JiraDeepResult inline in the ticket analyzer.
 * Web port of the desktop JiraAnalysisReport component.
 */

import { useState } from "react";
import type { JiraDeepResult } from "../../services/api";
import { QualityGauge } from "../code-analyzer/shared/QualityGauge";

interface Props {
  result: JiraDeepResult;
  jiraKey: string;
  /** Triage category for adaptive labels (defaults to bug-like behaviour) */
  category?: string;
}

export default function JiraAnalysisReport({ result, jiraKey, category }: Props) {
  const isBugLike =
    !category ||
    category === "" ||
    category.startsWith("Bug") ||
    category.startsWith("Incident");

  const labelErrorType = isBugLike ? "Error Type" : "Type";
  const labelRootCause = isBugLike ? "Root Cause" : "Analysis";
  const labelTechnical = isBugLike ? "Technical Analysis" : "Technical Assessment";

  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  function toggleAction(i: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {/* Zap icon */}
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span className="text-sm font-semibold text-slate-200">
          Deep Analysis — {jiraKey}
        </span>
      </div>

      {/* Plain Language Summary */}
      <Section
        icon={
          <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        }
        title="Plain Language Summary"
      >
        <p className="text-sm text-slate-300 leading-relaxed">{result.plain_summary}</p>
      </Section>

      {/* Ticket Quality */}
      <Section
        icon={
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        }
        title="Ticket Quality"
      >
        <div className="flex items-center gap-4 mb-3">
          <QualityGauge score={result.quality.score} size={56} />
          <div>
            <span className={`text-sm font-semibold ${qualityColor(result.quality.verdict)}`}>
              {result.quality.verdict}
            </span>
            <span className="text-xs text-slate-500 ml-2">({result.quality.score}/100)</span>
          </div>
        </div>
        {result.quality.strengths.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
            <ul className="space-y-0.5">
              {result.quality.strengths.map((s, i) => (
                <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                  {/* CheckCircle2 */}
                  <svg className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.quality.gaps.length > 0 && (
          <div>
            <p className="text-xs text-red-400 font-medium mb-1">Gaps</p>
            <ul className="space-y-0.5">
              {result.quality.gaps.map((g, i) => (
                <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                  {/* AlertTriangle */}
                  <svg className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Technical Analysis */}
      <Section
        icon={
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        }
        title={labelTechnical}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
          <span className="text-slate-500 font-medium">{labelErrorType}:</span>
          <span className="text-slate-300">{result.technical.error_type}</span>
          <span className="text-slate-500 font-medium">Severity:</span>
          <span className="text-amber-300 font-semibold">{result.technical.severity_estimate}</span>
          <span className="text-slate-500 font-medium">Confidence:</span>
          <span className="text-slate-300">
            {result.technical.confidence} — {result.technical.confidence_rationale}
          </span>
        </div>
        <div className="mb-2">
          <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">
            {labelRootCause}
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">{result.technical.root_cause}</p>
        </div>
        {result.technical.affected_areas.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">
              Affected Areas
            </p>
            <div className="flex flex-wrap gap-1">
              {result.technical.affected_areas.map((a) => (
                <span
                  key={a}
                  className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300 font-mono"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Open Questions — hidden if empty */}
      {result.open_questions.length > 0 && (
        <Section
          icon={
            <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
          title="Open Questions"
        >
          <ul className="space-y-1">
            {result.open_questions.map((q, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-yellow-500 font-medium text-xs mt-1 flex-shrink-0">
                  {i + 1}.
                </span>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Recommended Actions */}
      <Section
        icon={
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        }
        title="Recommended Actions"
      >
        <p className="text-xs text-slate-500 mb-2">
          Check off items as your team validates them:
        </p>
        <ul className="space-y-2">
          {result.recommended_actions.map((action, i) => (
            <li
              key={i}
              className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
                checkedActions.has(i)
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-slate-700 bg-slate-800/40"
              }`}
            >
              <input
                type="checkbox"
                checked={checkedActions.has(i)}
                onChange={() => toggleAction(i)}
                className="mt-1 accent-green-500 flex-shrink-0 cursor-pointer"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge(action.priority)}`}
                  >
                    {action.priority}
                  </span>
                </div>
                <p
                  className={`text-sm leading-snug ${
                    checkedActions.has(i)
                      ? "line-through text-slate-500"
                      : "text-slate-200"
                  }`}
                >
                  {action.action}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{action.rationale}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Risk & Impact */}
      <Section
        icon={
          <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        }
        title="Risk & Impact"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="text-slate-500 font-medium">User Impact:</span>
          <span className="text-slate-300">{result.risk.user_impact}</span>
          <span className="text-slate-500 font-medium">Blast Radius:</span>
          <span className="text-amber-300 font-semibold">{result.risk.blast_radius}</span>
          <span className="text-slate-500 font-medium">Urgency:</span>
          <span className="text-amber-300 font-semibold">{result.risk.urgency}</span>
          <span className="text-slate-500 font-medium">Do-Nothing Risk:</span>
          <span className="text-slate-300">{result.risk.do_nothing_risk}</span>
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          {icon}
          {title}
        </div>
        {open ? (
          /* ChevronUp */
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        ) : (
          /* ChevronDown */
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function qualityColor(verdict: string): string {
  if (verdict === "Good" || verdict === "Excellent") return "text-green-400";
  if (verdict === "Needs Work") return "text-amber-400";
  return "text-red-400";
}

function priorityBadge(priority: string): string {
  if (priority === "Immediate") return "bg-red-500/20 text-red-400";
  if (priority === "Short-term") return "bg-amber-500/20 text-amber-400";
  return "bg-blue-500/20 text-blue-400";
}
