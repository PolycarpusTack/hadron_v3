/**
 * JiraAnalysisReport
 * Renders a structured JiraDeepResult inline in the ticket analyzer.
 */

import { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ClipboardList,
  Zap,
  Shield,
  HelpCircle,
  List,
} from "lucide-react";
import type {
  JiraDeepResult,
} from "../../services/api";

interface Props {
  analysisId: number;
  jiraKey: string;
  result: JiraDeepResult;
  onViewInHistory: (id: number) => void;
  /** Triage category for adaptive labels (defaults to "Bug") */
  category?: string;
}

export default function JiraAnalysisReport({ analysisId, jiraKey, result, onViewInHistory, category = "Bug" }: Props) {
  const isBugLike = ["Bug", "Security", "Performance"].includes(category);
  const labelErrorType = isBugLike ? "Error Type" : "Type";
  const labelRootCause = isBugLike ? "Root Cause" : "Analysis";
  const labelTechnical  = isBugLike ? "Technical Analysis" : "Technical Assessment";
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">
            Deep Analysis — {jiraKey}
          </span>
        </div>
        <button
          onClick={() => onViewInHistory(analysisId)}
          className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" /> View in History
        </button>
      </div>

      {/* Plain Summary */}
      <Section
        icon={<Info className="w-4 h-4 text-sky-400" />}
        title="Plain Language Summary"
      >
        <p className="text-sm text-gray-300 leading-relaxed">{result.plain_summary}</p>
      </Section>

      {/* Quality Score */}
      <Section
        icon={<ClipboardList className="w-4 h-4 text-purple-400" />}
        title="Ticket Quality"
      >
        <div className="flex items-center gap-3 mb-3">
          <QualityGauge score={result.quality.score} />
          <div>
            <span className={`text-sm font-semibold ${qualityColor(result.quality.verdict)}`}>
              {result.quality.verdict}
            </span>
            <span className="text-xs text-gray-500 ml-2">({result.quality.score}/100)</span>
          </div>
        </div>
        {result.quality.strengths.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
            <ul className="space-y-0.5">
              {result.quality.strengths.map((s, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.quality.gaps.length > 0 && (
          <div>
            <p className="text-xs text-amber-400 font-medium mb-1">Gaps</p>
            <ul className="space-y-0.5">
              {result.quality.gaps.map((g, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Technical Analysis */}
      <Section
        icon={<AlertCircle className="w-4 h-4 text-red-400" />}
        title={labelTechnical}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
          <span className="text-gray-500 font-medium">{labelErrorType}:</span>
          <span className="text-gray-300">{result.technical.error_type}</span>
          <span className="text-gray-500 font-medium">Severity:</span>
          <span className="text-amber-300 font-semibold">{result.technical.severity_estimate}</span>
          <span className="text-gray-500 font-medium col-span-1">Confidence:</span>
          <span className="text-gray-300 col-span-1">
            {result.technical.confidence} — {result.technical.confidence_rationale}
          </span>
        </div>
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">
            {labelRootCause}
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">{result.technical.root_cause}</p>
        </div>
        {result.technical.affected_areas.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">
              Affected Areas
            </p>
            <div className="flex flex-wrap gap-1">
              {result.technical.affected_areas.map((a) => (
                <span
                  key={a}
                  className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300 font-mono"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Open Questions */}
      {result.open_questions.length > 0 && (
        <Section
          icon={<HelpCircle className="w-4 h-4 text-yellow-400" />}
          title="Open Questions"
        >
          <ul className="space-y-1">
            {result.open_questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-yellow-500 font-medium text-xs mt-1 flex-shrink-0">
                  {i + 1}.
                </span>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Recommended Actions — with validation checkboxes */}
      <Section
        icon={<List className="w-4 h-4 text-green-400" />}
        title="Recommended Actions"
      >
        <p className="text-xs text-gray-500 mb-2">
          Check off items as your team validates them:
        </p>
        <ul className="space-y-2">
          {result.recommended_actions.map((action, i) => (
            <li
              key={i}
              className={`flex items-start gap-3 p-2.5 rounded-lg border transition ${
                checkedActions.has(i)
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-gray-700 bg-gray-800/40"
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
                      ? "line-through text-gray-500"
                      : "text-gray-200"
                  }`}
                >
                  {action.action}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{action.rationale}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Risk & Impact */}
      <Section
        icon={<Shield className="w-4 h-4 text-orange-400" />}
        title="Risk & Impact"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="text-gray-500 font-medium">Blast Radius:</span>
          <span className="text-amber-300 font-semibold">{result.risk.blast_radius}</span>
          <span className="text-gray-500 font-medium">Urgency:</span>
          <span className="text-amber-300 font-semibold">{result.risk.urgency}</span>
          <span className="text-gray-500 font-medium">User Impact:</span>
          <span className="text-gray-300">{result.risk.user_impact}</span>
          <span className="text-gray-500 font-medium">Do-Nothing Risk:</span>
          <span className="text-gray-300">{result.risk.do_nothing_risk}</span>
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
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/30 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}
          {title}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function QualityGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const r = 18;
  const cx = 24;
  const cy = 24;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="4" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={color} fontWeight="bold">
        {score}
      </text>
    </svg>
  );
}

function qualityColor(verdict: string) {
  if (verdict === "Good" || verdict === "Excellent") return "text-green-400";
  if (verdict === "Needs Work") return "text-amber-400";
  return "text-red-400";
}

function priorityBadge(priority: string) {
  if (priority === "Immediate") return "bg-red-500/20 text-red-400";
  if (priority === "Short-term") return "bg-amber-500/20 text-amber-400";
  return "bg-blue-500/20 text-blue-400";
}
