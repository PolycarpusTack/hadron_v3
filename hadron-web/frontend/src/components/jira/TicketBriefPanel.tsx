/**
 * TicketBriefPanel
 * Full investigation brief — tabbed display combining triage + deep analysis.
 * Web port of the desktop TicketBriefPanel, adapted for Tailwind dark (slate) theme.
 */

import { useState, type ReactNode } from "react";
import { api, type JiraBriefResult, type TicketBriefRow, type SimilarTicketMatch } from "../../services/api";
import { QualityGauge } from "../code-analyzer/shared/QualityGauge";
import TriageBadgePanel from "./TriageBadgePanel";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Props ────────────────────────────────────────────────────────────────────

interface TicketBriefPanelProps {
  jiraKey: string;
  result: JiraBriefResult;
  briefRow: TicketBriefRow | null;
  onBriefUpdated?: () => void;
}

type BriefTab = "brief" | "analysis";

// ─── Main component ───────────────────────────────────────────────────────────

export default function TicketBriefPanel({
  jiraKey,
  result,
  briefRow,
  onBriefUpdated,
}: TicketBriefPanelProps) {
  const [tab, setTab] = useState<BriefTab>("brief");
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  // Similar tickets state
  const [similarTickets, setSimilarTickets] = useState<SimilarTicketMatch[]>([]);
  const [searchingSimilar, setSearchingSimilar] = useState(false);

  // Post-to-JIRA state
  const [posting, setPosting] = useState(false);

  // Feedback state
  const [rating, setRating] = useState<number>(briefRow?.engineerRating || 0);
  const [notes, setNotes] = useState(briefRow?.engineerNotes || "");
  const [showNotes, setShowNotes] = useState(false);

  function toggleAction(i: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleFindSimilar = async () => {
    setSearchingSimilar(true);
    try {
      const results = await api.findSimilarTickets(jiraKey, 0.65, 5);
      setSimilarTickets(results);
    } catch {
      // silently fail — not critical
    } finally {
      setSearchingSimilar(false);
    }
  };

  const handlePostToJira = async () => {
    // F12 (2026-04-20 audit): AI-authored content is posted to JIRA as a
    // real comment. The server now requires a preview-then-confirm flow
    // bound to the exact markup the user agrees to; we fetch the
    // preview, let the user see the rendered body, and confirm with
    // the matching content hash.
    setPosting(true);
    try {
      const preview = await api.previewBriefForJira(jiraKey);
      const confirmed = window.confirm(
        `Post this brief as a comment on ${jiraKey}?\n\n` +
          `Preview (first 600 chars):\n${preview.markup.slice(0, 600)}` +
          (preview.markup.length > 600 ? "\n… (truncated)" : ""),
      );
      if (!confirmed) {
        setPosting(false);
        return;
      }
      await api.postBriefToJira(jiraKey, preview.contentHash);
      onBriefUpdated?.();
    } catch {
      // error feedback could be added here
    } finally {
      setPosting(false);
    }
  };

  const handleRating = async (value: number) => {
    setRating(value);
    await api.submitEngineerFeedback(jiraKey, value).catch(() => {});
    onBriefUpdated?.();
  };

  const handleNotesBlur = async () => {
    if (notes !== (briefRow?.engineerNotes || "")) {
      await api.submitEngineerFeedback(jiraKey, undefined, notes).catch(() => {});
      onBriefUpdated?.();
    }
  };

  // Adapt labels for non-bug ticket types
  const isBugLike = ["Bug", "Security", "Performance"].includes(result.triage.category);
  const labelErrorType = isBugLike ? "Error Type" : "Type";
  const labelRootCause = isBugLike ? "Root Cause" : "Analysis";
  const labelTechnical = isBugLike ? "Technical Analysis" : "Technical Assessment";

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <IconFileText className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-semibold text-white">
              Investigation Brief — {jiraKey}
            </span>
          </div>

          {/* Actions: tab switcher + post button + stars */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Star rating */}
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleRating(star)}
                  className={`text-lg leading-none ${star <= rating ? "text-yellow-400" : "text-slate-600"} hover:text-yellow-300 transition-colors`}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Notes toggle */}
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
              {showNotes ? "Hide Notes" : "Notes"}
            </button>

            {/* Post to JIRA */}
            <button
              onClick={handlePostToJira}
              disabled={posting || !!briefRow?.postedToJira}
              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {briefRow?.postedToJira
                ? `Posted ${briefRow.postedAt ? new Date(briefRow.postedAt).toLocaleDateString() : ""}`
                : posting
                  ? "Posting..."
                  : "Post to JIRA"}
            </button>

            {/* Tab switcher */}
            <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5">
              {(["brief", "analysis"] as BriefTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs rounded-md transition capitalize ${
                    tab === t
                      ? "bg-indigo-600 text-white font-medium"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t === "brief" ? "Brief" : "Analysis"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notes textarea (shown when toggled) */}
        {showNotes && (
          <div className="mt-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Engineer notes..."
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              rows={3}
            />
          </div>
        )}
      </div>

      {/* Brief tab */}
      {tab === "brief" && (
        <div className="p-4 space-y-4">
          {/* Triage summary */}
          <TriageBadgePanel result={result.triage} />

          {/* Plain summary */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-sm text-slate-300 leading-relaxed">
              {result.analysis.plain_summary}
            </p>
          </div>

          {/* Customer impact */}
          <Section
            icon={<IconUsers className="w-4 h-4 text-sky-400" />}
            title="Customer Impact"
          >
            <p className="text-sm text-slate-300 leading-relaxed">
              {result.triage.customer_impact}
            </p>
          </Section>

          {/* Technical analysis */}
          <Section
            icon={<IconAlertCircle className="w-4 h-4 text-red-400" />}
            title={labelTechnical}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
              <MetaRow label={labelErrorType} value={result.analysis.technical.error_type} />
              <MetaRow
                label="Severity"
                value={result.analysis.technical.severity_estimate}
                highlight
              />
              <MetaRow
                label="Confidence"
                value={`${result.analysis.technical.confidence} — ${result.analysis.technical.confidence_rationale}`}
                span
              />
            </div>
            <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">
              {labelRootCause}
            </p>
            <p className="text-sm text-slate-300 leading-relaxed mb-3">
              {result.analysis.technical.root_cause}
            </p>
            {result.analysis.technical.affected_areas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.analysis.technical.affected_areas.map((a) => (
                  <span
                    key={a}
                    className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300 font-mono"
                  >
                    {a}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Recommended actions */}
          <Section
            icon={<IconList className="w-4 h-4 text-green-400" />}
            title="Recommended Actions"
          >
            <p className="text-xs text-slate-500 mb-2">
              Check off as your team validates:
            </p>
            <ul className="space-y-2">
              {result.analysis.recommended_actions.map((action, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-3 p-2.5 rounded-lg border transition ${
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
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${priorityBadge(action.priority)}`}
                    >
                      {action.priority}
                    </span>
                    <p
                      className={`text-sm leading-snug inline ${
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
            icon={<IconShield className="w-4 h-4 text-orange-400" />}
            title="Risk & Impact"
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <MetaRow label="Blast Radius" value={result.analysis.risk.blast_radius} highlight />
              <MetaRow label="Urgency" value={result.analysis.risk.urgency} highlight />
              <MetaRow label="User Impact" value={result.analysis.risk.user_impact} span />
              <MetaRow
                label="Do-Nothing Risk"
                value={result.analysis.risk.do_nothing_risk}
                span
              />
            </div>
          </Section>

          {/* Triage rationale */}
          <Section
            icon={<IconBrain className="w-4 h-4 text-purple-400" />}
            title="Triage Rationale"
          >
            <p className="text-xs text-slate-400 mb-2">
              <span className="text-slate-500">{result.triage.confidence} confidence</span>
            </p>
            <p className="text-sm text-slate-400 italic leading-relaxed">
              {result.triage.rationale}
            </p>
          </Section>

          {/* Similar Tickets */}
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-300">Similar Tickets</h4>
              <button
                onClick={handleFindSimilar}
                disabled={searchingSimilar}
                className="rounded-md bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors"
              >
                {searchingSimilar ? "Searching..." : "Find Similar"}
              </button>
            </div>
            {similarTickets.length > 0 ? (
              <div className="space-y-2">
                {similarTickets.map((t) => (
                  <div
                    key={t.jiraKey}
                    className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/50 p-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs text-blue-400 flex-shrink-0">{t.jiraKey}</span>
                      {t.severity && (
                        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400 flex-shrink-0">
                          {t.severity}
                        </span>
                      )}
                      <span className="text-sm text-slate-300 truncate">{t.title}</span>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                      {Math.round(t.similarity * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : searchingSimilar ? null : (
              <p className="text-xs text-slate-500">
                Click "Find Similar" to search for duplicate tickets.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Analysis tab */}
      {tab === "analysis" && (
        <div className="p-4 space-y-4">
          {/* Ticket quality */}
          <Section
            icon={<IconFileText className="w-4 h-4 text-purple-400" />}
            title="Ticket Quality"
          >
            <div className="flex items-center gap-3 mb-3">
              <QualityGauge score={result.analysis.quality.score} size={48} />
              <div>
                <span className={`text-sm font-semibold ${qualityColor(result.analysis.quality.verdict)}`}>
                  {result.analysis.quality.verdict}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  ({result.analysis.quality.score}/100)
                </span>
              </div>
            </div>

            {result.analysis.quality.strengths.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {result.analysis.quality.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                      <IconCheckCircle className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.analysis.quality.gaps.length > 0 && (
              <div>
                <p className="text-xs text-amber-400 font-medium mb-1">Gaps</p>
                <ul className="space-y-0.5">
                  {result.analysis.quality.gaps.map((g, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                      <IconAlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* Open questions */}
          {result.analysis.open_questions.length > 0 && (
            <Section
              icon={<IconHelpCircle className="w-4 h-4 text-yellow-400" />}
              title="Open Questions"
            >
              <ul className="space-y-1">
                {result.analysis.open_questions.map((q, i) => (
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
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-700/30 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}
          {title}
        </div>
        {open ? (
          <IconChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <IconChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function MetaRow({
  label,
  value,
  highlight,
  span,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  span?: boolean;
}) {
  return (
    <>
      <span className={`text-slate-500 font-medium text-xs ${span ? "col-span-2" : ""}`}>
        {label}:
      </span>
      <span
        className={`text-xs ${highlight ? "text-amber-300 font-semibold" : "text-slate-300"} ${span ? "col-span-2" : ""}`}
      >
        {value}
      </span>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function IconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

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

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z" />
    </svg>
  );
}

function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconHelpCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

// Suppress unused variable warnings for SEVERITY_BADGE and CATEGORY_COLORS
// (exported for potential use by parent components)
export { SEVERITY_BADGE, CATEGORY_COLORS };
