/**
 * TicketBriefPanel
 * Full investigation brief — tabbed display combining triage + deep analysis.
 * Shown after "Generate Brief" runs, or when loaded from DB on ticket fetch.
 */

import { useState, type ReactNode } from "react";
import {
  FileText, ShieldAlert, AlertCircle, HelpCircle,
  List, Shield, CheckCircle2, AlertTriangle, ChevronDown,
  ChevronUp, Users, Brain, Search, Loader2,
  Send, Star, MessageSquare,
} from "lucide-react";
import type { JiraBriefResult } from "../../services/jira-assist";
import {
  SEVERITY_BADGE, CATEGORY_COLORS, CONFIDENCE_COLOR,
  findSimilarTickets, type SimilarTicket,
  postBriefToJira, submitEngineerFeedback, deleteTicketBrief,
} from "../../services/jira-assist";
import { getStoredApiKey } from "../../services/api";

interface TicketBriefPanelProps {
  jiraKey: string;
  title: string;
  description: string;
  result: JiraBriefResult;
  /** When true shows a subtle "loaded from DB" indicator */
  fromCache?: boolean;
  // Sprint 5: JIRA round-trip + engineer feedback
  briefJson: string | null;
  postedToJira: boolean;
  postedAt: string | null;
  engineerRating: number | null;
  engineerNotes: string | null;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  onBriefUpdated?: () => void;
}

type BriefTab = "brief" | "analysis";

export default function TicketBriefPanel({
  jiraKey, title, description, result, fromCache,
  briefJson, postedToJira, postedAt, engineerRating, engineerNotes,
  jiraBaseUrl, jiraEmail, jiraApiToken, onBriefUpdated,
}: TicketBriefPanelProps) {
  const [tab, setTab] = useState<BriefTab>("brief");
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());
  const [similarTickets, setSimilarTickets] = useState<SimilarTicket[]>([]);
  const [searchingSimilar, setSearchingSimilar] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);

  // Sprint 5: Post to JIRA
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(postedToJira);
  const [postDate, setPostDate] = useState(postedAt);
  const [postError, setPostError] = useState<string | null>(null);

  // Sprint 5: Engineer feedback
  const [rating, setRating] = useState<number | null>(engineerRating);
  const [notes, setNotes] = useState(engineerNotes ?? "");
  const [showNotes, setShowNotes] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);

  function toggleAction(i: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleFindSimilar() {
    setSearchingSimilar(true);
    setSimilarError(null);
    try {
      const apiKey = await getStoredApiKey();
      if (!apiKey) {
        setSimilarError("No API key configured. Set one in Settings.");
        return;
      }
      const results = await findSimilarTickets({
        jiraKey,
        title,
        description,
        apiKey,
      });
      setSimilarTickets(results);
    } catch (err) {
      setSimilarError(`Search failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSearchingSimilar(false);
    }
  }

  async function handlePostToJira() {
    if (!briefJson || posted) return;
    if (!confirm(`Post investigation brief for ${jiraKey} to JIRA as a comment?`)) return;

    setPosting(true);
    setPostError(null);
    try {
      await postBriefToJira({
        jiraKey,
        briefJson,
        baseUrl: jiraBaseUrl,
        email: jiraEmail,
        apiToken: jiraApiToken,
      });
      setPosted(true);
      setPostDate(new Date().toISOString());
      onBriefUpdated?.();
    } catch (err) {
      setPostError(`Post failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPosting(false);
    }
  }

  async function handleRating(star: number) {
    const newRating = star === rating ? null : star;
    setRating(newRating);
    setSavingFeedback(true);
    try {
      await submitEngineerFeedback({ jiraKey, rating: newRating, notes: notes || null });
    } catch {
      // Optimistic — silently fail
    } finally {
      setSavingFeedback(false);
    }
  }

  async function handleSaveNotes() {
    setSavingFeedback(true);
    try {
      await submitEngineerFeedback({ jiraKey, rating, notes: notes || null });
    } catch {
      // Silently fail
    } finally {
      setSavingFeedback(false);
    }
  }

  async function handleDeleteBrief() {
    if (!confirm(`Delete the stored brief for ${jiraKey}? This removes triage, analysis, and embeddings.`)) return;
    try {
      await deleteTicketBrief(jiraKey);
      onBriefUpdated?.();
    } catch (err) {
      setPostError(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const severityClass  = SEVERITY_BADGE[result.triage.severity]   ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const categoryClass  = CATEGORY_COLORS[result.triage.category]  ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const confidenceClass = CONFIDENCE_COLOR[result.triage.confidence] ?? "text-gray-400";

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Investigation Brief — {jiraKey}</span>
          {fromCache && (
            <span className="text-xs text-gray-600 italic">· saved</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Post to JIRA */}
          {posted ? (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Posted{postDate && ` · ${new Date(postDate).toLocaleDateString()}`}
            </span>
          ) : (
            <button
              onClick={handlePostToJira}
              disabled={posting || !briefJson}
              className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 transition flex items-center gap-1.5"
            >
              {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {posting ? "Posting..." : "Post to JIRA"}
            </button>
          )}

          {/* Delete brief */}
          <button
            onClick={handleDeleteBrief}
            className="text-xs px-2 py-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"
            title="Delete stored brief"
          >
            ✕
          </button>

          {/* Tab switcher */}
          <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
            {(["brief", "analysis"] as BriefTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 text-xs rounded-md transition capitalize ${
                  tab === t
                    ? "bg-indigo-600 text-white font-medium"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {t === "brief" ? "Brief" : "Analysis"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Engineer Feedback + Post Error */}
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-4">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRating(star)}
              className="p-0.5 transition"
              title={`Rate ${star}/5`}
            >
              <Star
                className={`w-4 h-4 ${
                  rating && star <= rating
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-gray-600 hover:text-yellow-400"
                }`}
              />
            </button>
          ))}
          {rating && <span className="text-xs text-gray-500 ml-1">{rating}/5</span>}
        </div>

        <button
          onClick={() => setShowNotes(!showNotes)}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition"
        >
          <MessageSquare className="w-3 h-3" />
          {notes ? "Edit notes" : "Add notes"}
        </button>

        {postError && <span className="text-xs text-red-400 ml-auto">{postError}</span>}
      </div>

      {/* Notes input */}
      {showNotes && (
        <div className="px-4 py-2 border-b border-gray-700">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Engineer notes about this brief..."
            rows={2}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500"
          />
          <div className="flex justify-end mt-1">
            <button
              onClick={handleSaveNotes}
              disabled={savingFeedback}
              className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium disabled:opacity-50 transition"
            >
              {savingFeedback ? "Saving..." : "Save Notes"}
            </button>
          </div>
        </div>
      )}

      {/* Brief tab */}
      {tab === "brief" && (
        <div className="p-4 space-y-4">
          {/* Triage summary row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Triage</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${severityClass}`}>
              {result.triage.severity}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${categoryClass}`}>
              {result.triage.category}
            </span>
            {result.triage.tags.map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                {tag}
              </span>
            ))}
          </div>

          {/* Plain summary */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <p className="text-sm text-gray-300 leading-relaxed">{result.analysis.plain_summary}</p>
          </div>

          {/* Customer impact */}
          <Section icon={<Users className="w-4 h-4 text-sky-400" />} title="Customer Impact">
            <p className="text-sm text-gray-300 leading-relaxed">{result.triage.customer_impact}</p>
          </Section>

          {/* Technical */}
          <Section icon={<AlertCircle className="w-4 h-4 text-red-400" />} title="Technical Analysis">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
              <MetaRow label="Error Type" value={result.analysis.technical.error_type} />
              <MetaRow label="Severity" value={result.analysis.technical.severity_estimate} highlight />
              <MetaRow
                label="Confidence"
                value={`${result.analysis.technical.confidence} — ${result.analysis.technical.confidence_rationale}`}
                span
              />
            </div>
            <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">Root Cause</p>
            <p className="text-sm text-gray-300 leading-relaxed mb-3">{result.analysis.technical.root_cause}</p>
            {result.analysis.technical.affected_areas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.analysis.technical.affected_areas.map((a) => (
                  <span key={a} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300 font-mono">{a}</span>
                ))}
              </div>
            )}
          </Section>

          {/* Recommended actions */}
          <Section icon={<List className="w-4 h-4 text-green-400" />} title="Recommended Actions">
            <p className="text-xs text-gray-500 mb-2">Check off as your team validates:</p>
            <ul className="space-y-2">
              {result.analysis.recommended_actions.map((action, i) => (
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
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${priorityBadge(action.priority)}`}>
                      {action.priority}
                    </span>
                    <p className={`text-sm leading-snug inline ${checkedActions.has(i) ? "line-through text-gray-500" : "text-gray-200"}`}>
                      {action.action}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{action.rationale}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {/* Risk */}
          <Section icon={<Shield className="w-4 h-4 text-orange-400" />} title="Risk & Impact">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <MetaRow label="Blast Radius" value={result.analysis.risk.blast_radius} highlight />
              <MetaRow label="Urgency"      value={result.analysis.risk.urgency} highlight />
              <MetaRow label="User Impact"     value={result.analysis.risk.user_impact} span />
              <MetaRow label="Do-Nothing Risk" value={result.analysis.risk.do_nothing_risk} span />
            </div>
          </Section>

          {/* Triage rationale */}
          <Section icon={<Brain className="w-4 h-4 text-purple-400" />} title="Triage Rationale">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs ${confidenceClass}`}>{result.triage.confidence} confidence</span>
            </div>
            <p className="text-sm text-gray-400 italic leading-relaxed">{result.triage.rationale}</p>
          </Section>

          {/* Similar Tickets */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Search className="w-4 h-4 text-cyan-400" />
                Similar Tickets
              </div>
              <button
                onClick={handleFindSimilar}
                disabled={searchingSimilar}
                className="text-xs px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium disabled:opacity-50 transition flex items-center gap-1.5"
              >
                {searchingSimilar && <Loader2 className="w-3 h-3 animate-spin" />}
                {searchingSimilar ? "Searching..." : "Find Similar"}
              </button>
            </div>

            {similarError && (
              <div className="px-4 pb-3">
                <p className="text-xs text-red-400">{similarError}</p>
              </div>
            )}

            {similarTickets.length > 0 && (
              <div className="px-4 pb-4 space-y-2">
                {similarTickets.map((ticket) => (
                  <div
                    key={ticket.jira_key}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-gray-700 bg-gray-800/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-cyan-400 font-semibold">
                          {ticket.jira_key}
                        </span>
                        {ticket.severity && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            SEVERITY_BADGE[ticket.severity] ?? "bg-gray-700 text-gray-300"
                          }`}>
                            {ticket.severity}
                          </span>
                        )}
                        {ticket.category && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            CATEGORY_COLORS[ticket.category] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30"
                          }`}>
                            {ticket.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300 truncate">{ticket.title}</p>
                    </div>
                    <span className="text-xs font-semibold text-cyan-300 ml-3 flex-shrink-0">
                      {Math.round(ticket.similarity * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!searchingSimilar && similarTickets.length === 0 && !similarError && (
              <div className="px-4 pb-3">
                <p className="text-xs text-gray-500">Click "Find Similar" to search for duplicate or related tickets.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis tab — ticket quality + open questions */}
      {tab === "analysis" && (
        <div className="p-4 space-y-4">
          {/* Ticket quality */}
          <Section icon={<FileText className="w-4 h-4 text-purple-400" />} title="Ticket Quality">
            <div className="flex items-center gap-3 mb-3">
              <QualityGauge score={result.analysis.quality.score} />
              <div>
                <span className={`text-sm font-semibold ${qualityColor(result.analysis.quality.verdict)}`}>
                  {result.analysis.quality.verdict}
                </span>
                <span className="text-xs text-gray-500 ml-2">({result.analysis.quality.score}/100)</span>
              </div>
            </div>
            {result.analysis.quality.strengths.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {result.analysis.quality.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
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
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* Open questions */}
          {result.analysis.open_questions.length > 0 && (
            <Section icon={<HelpCircle className="w-4 h-4 text-yellow-400" />} title="Open Questions">
              <ul className="space-y-1">
                {result.analysis.open_questions.map((q, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-yellow-500 font-medium text-xs mt-1 flex-shrink-0">{i + 1}.</span>
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/30 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}{title}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function MetaRow({ label, value, highlight, span }: { label: string; value: string; highlight?: boolean; span?: boolean }) {
  return (
    <>
      <span className={`text-gray-500 font-medium text-xs ${span ? "col-span-2" : ""}`}>{label}:</span>
      <span className={`text-xs ${highlight ? "text-amber-300 font-semibold" : "text-gray-300"} ${span ? "col-span-2" : ""}`}>
        {value}
      </span>
    </>
  );
}

function QualityGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const r = 18, cx = 24, cy = 24, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="4" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={color} fontWeight="bold">{score}</text>
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
