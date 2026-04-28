/**
 * JiraAnalyzerView
 * Orchestrator for JIRA Deep Analysis — ticket fetch, AI streaming, and
 * structured report display.
 *
 * JIRA credentials are admin-configured server-side (poller config).
 * This component no longer stores or transmits credentials.
 */

import { useCallback, useEffect, useState } from "react";
import { useAiStream } from "../../hooks/useAiStream";
import { api, type JiraTicketDetail, type JiraDeepResult, type JiraTriageResult, type JiraBriefResult, type TicketBriefRow, type PollerConfigStatus } from "../../services/api";
import { useToast } from "../Toast";
import JiraAnalysisReport from "./JiraAnalysisReport";
import TriageBadgePanel from "./TriageBadgePanel";
import TicketBriefPanel from "./TicketBriefPanel";
import { investigationService, type InvestigationDossier } from "../../services/investigation";
import { InvestigationPanel } from "./InvestigationPanel";

// Regex to extract a JIRA ticket key from a URL like /browse/PROJ-123
const TICKET_KEY_RE = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/i;

export function JiraAnalyzerView() {
  // JIRA server-side configuration status
  const [jiraConfigured, setJiraConfigured] = useState<boolean | null>(null);

  // Ticket state
  const [ticketKey, setTicketKey] = useState("");
  const [ticket, setTicket] = useState<JiraTicketDetail | null>(null);
  const [fetching, setFetching] = useState(false);

  // Analysis state
  const [result, setResult] = useState<JiraDeepResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Triage + brief state
  const [triageResult, setTriageResult] = useState<JiraTriageResult | null>(null);
  const [triaging, setTriaging] = useState(false);
  const [briefResult, setBriefResult] = useState<JiraBriefResult | null>(null);
  const [cachedBrief, setCachedBrief] = useState<TicketBriefRow | null>(null);

  // Investigation state
  const [investigating, setInvestigating] = useState(false);
  const [investigationDossier, setInvestigationDossier] = useState<InvestigationDossier | null>(null);
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  const { streamAi, content, isStreaming, error, reset } = useAiStream();
  const toast = useToast();

  // Check whether JIRA is configured on the server on mount
  useEffect(() => {
    api.getPollerConfig()
      .then((status: PollerConfigStatus) => {
        setJiraConfigured(!!(status.jiraBaseUrl && status.jiraEmail && status.hasApiToken));
      })
      .catch(() => {
        // Not an admin — can't read poller config. Assume configured and let
        // server return a proper error on first use if not.
        setJiraConfigured(true);
      });
  }, []);

  // Auto-extract ticket key when user pastes a JIRA URL
  function handleTicketKeyChange(value: string) {
    const match = value.match(TICKET_KEY_RE);
    if (match) {
      setTicketKey(match[1].toUpperCase());
    } else {
      setTicketKey(value.toUpperCase());
    }
  }

  // Parse AI response on stream completion
  useEffect(() => {
    if (isStreaming || !content) return;

    let parsed: JiraDeepResult | null = null;

    try {
      parsed = JSON.parse(content) as JiraDeepResult;
    } catch {
      // Try extracting JSON object from raw content
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]) as JiraDeepResult;
        } catch {
          // Both strategies failed
        }
      }
    }

    if (parsed) {
      setResult(parsed);
      setParseError(null);
      // Reload the full cached brief from DB (server persisted triage + brief together)
      if (ticket) {
        api.getTicketBrief(ticket.key).then((cached) => {
          setCachedBrief(cached);
          if (cached?.briefJson) {
            try { setBriefResult(JSON.parse(cached.briefJson)); } catch {}
          }
          if (cached?.triageJson) {
            try { setTriageResult(JSON.parse(cached.triageJson)); } catch {}
          }
        }).catch(() => {/* ignore */});
      }
    } else {
      setParseError("Failed to parse AI response. The raw output is shown below.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, isStreaming]);

  const handleFetch = useCallback(async () => {
    const key = ticketKey.trim();
    if (!key) return;
    setFetching(true);
    setTicket(null);
    setResult(null);
    setParseError(null);
    setTriageResult(null);
    setBriefResult(null);
    reset();
    try {
      const detail = await api.fetchJiraIssueDetail(key);
      setTicket(detail);
      // Load cached brief/triage from DB
      const cached = await api.getTicketBrief(key);
      setCachedBrief(cached);
      if (cached?.triageJson) {
        try { setTriageResult(JSON.parse(cached.triageJson)); } catch {}
      }
      if (cached?.briefJson) {
        try { setBriefResult(JSON.parse(cached.briefJson)); } catch {}
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fetch ticket",
      );
    } finally {
      setFetching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketKey, reset, toast]);

  const handleTriage = async () => {
    if (!ticket) return;
    setTriaging(true);
    try {
      const res = await api.triageJiraIssue(ticket.key);
      setTriageResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setTriaging(false);
    }
  };

  const handleBrief = () => {
    if (!ticket) return;
    setResult(null); // clear the Phase 1b deep result if any
    setBriefResult(null);
    setParseError(null);
    streamAi(`/jira/issues/${encodeURIComponent(ticket.key)}/brief/stream`, {});
  };

  const handleAnalyze = useCallback(() => {
    if (!ticket) return;
    setResult(null);
    setParseError(null);
    streamAi(`/jira/issues/${encodeURIComponent(ticket.key)}/analyze/stream`, {});
  }, [ticket, streamAi]);

  const handleInvestigate = async () => {
    if (!ticket) return;
    setInvestigating(true);
    setInvestigationError(null);
    setInvestigationDossier(null);
    try {
      const dossier = await investigationService.investigateTicket(ticket.key);
      setInvestigationDossier(dossier);
    } catch (err) {
      setInvestigationError(err instanceof Error ? err.message : String(err));
    } finally {
      setInvestigating(false);
    }
  };

  const handleClear = useCallback(() => {
    reset();
    setTicket(null);
    setTicketKey("");
    setResult(null);
    setParseError(null);
    setTriageResult(null);
    setBriefResult(null);
  }, [reset]);

  const canFetch = ticketKey.trim().length > 0;
  const canAnalyze = !!ticket && !isStreaming && !triaging && !investigating;

  // Loading state while checking JIRA config
  if (jiraConfigured === null) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        Checking JIRA configuration…
      </div>
    );
  }

  // Show banner if JIRA is not configured (non-blocking — admin may have just set it up)
  const jiraWarningBanner = !jiraConfigured ? (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
      JIRA is not configured. Ask an admin to set up JIRA credentials in the Admin panel
      (Admin → JIRA Poller).
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-200">JIRA Deep Analysis</h1>
        <button
          onClick={handleClear}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          Clear
        </button>
      </div>

      {jiraWarningBanner}

      {/* Ticket input */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="w-24 text-sm text-slate-400 flex-shrink-0">Ticket:</label>
          <input
            type="text"
            value={ticketKey}
            onChange={(e) => handleTicketKeyChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canFetch && handleFetch()}
            placeholder="PROJ-123 or paste URL"
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleFetch}
            disabled={!canFetch || fetching}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fetching ? "Fetching…" : "Fetch"}
          </button>
        </div>
      </div>

      {/* Ticket preview card */}
      {ticket && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
          {/* Key + summary row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={ticket.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono font-semibold text-blue-400 hover:underline"
              >
                {ticket.key}
              </a>
              <p className="text-base font-medium text-slate-200 mt-0.5 leading-snug">
                {ticket.summary}
              </p>
            </div>
            {/* Action buttons */}
            <div className="flex flex-shrink-0 gap-2">
              <button
                onClick={handleTriage}
                disabled={!canAnalyze || triaging}
                className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {triaging ? "Triaging…" : "Triage"}
              </button>
              <button
                onClick={handleBrief}
                disabled={!canAnalyze}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStreaming ? "Generating…" : "Generate Brief"}
              </button>
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="rounded-md bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStreaming ? "Analyzing…" : "Deep Analyze"}
              </button>
              <button
                onClick={handleInvestigate}
                disabled={!canAnalyze || investigating}
                className="rounded-md bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {investigating ? "Investigating…" : "Investigate"}
              </button>
            </div>
          </div>

          {/* Status / priority / type badges */}
          <div className="flex flex-wrap gap-2">
            <Badge color="blue">{ticket.issueType}</Badge>
            <Badge color="slate">{ticket.status}</Badge>
            {ticket.priority && <Badge color="amber">{ticket.priority}</Badge>}
          </div>

          {/* Components + labels as pills */}
          {(ticket.components.length > 0 || ticket.labels.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {ticket.components.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300"
                >
                  {c}
                </span>
              ))}
              {ticket.labels.map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300"
                >
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Description (truncated 3 lines) */}
          {ticket.description && (
            <p className="text-sm text-slate-400 leading-relaxed line-clamp-3">
              {ticket.description}
            </p>
          )}

          {/* Comment count */}
          {ticket.comments.length > 0 && (
            <p className="text-xs text-slate-500">
              {ticket.comments.length} comment{ticket.comments.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-purple-400">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Analyzing ticket…
          </div>
          {content && (
            <pre className="max-h-[200px] overflow-y-auto rounded bg-slate-900 p-2 text-xs text-slate-400">
              {content}
            </pre>
          )}
        </div>
      )}

      {/* Stream error */}
      {!isStreaming && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Parse error */}
      {!isStreaming && parseError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="mb-2 text-sm font-medium text-yellow-400">{parseError}</p>
          <pre className="max-h-[300px] overflow-y-auto rounded bg-slate-900 p-2 text-xs text-slate-400">
            {content}
          </pre>
        </div>
      )}

      {/* Brief panel (triage + deep analysis combined) */}
      {briefResult && ticket && (
        <TicketBriefPanel
            jiraKey={ticket.key}
            result={briefResult}
            briefRow={cachedBrief}
            onBriefUpdated={async () => {
              const updated = await api.getTicketBrief(ticket.key);
              setCachedBrief(updated);
            }}
          />
      )}

      {/* Triage-only panel (shown when no brief yet) */}
      {!briefResult && triageResult && (
        <TriageBadgePanel result={triageResult} />
      )}

      {/* Deep analysis report (from Phase 1b direct streaming) */}
      {result && ticket && (
        <JiraAnalysisReport
          result={result}
          jiraKey={ticket.key}
          category={ticket.issueType}
        />
      )}

      {/* Investigation results */}
      {investigationError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Investigation failed: {investigationError}
        </div>
      )}
      {investigationDossier && !investigating && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Investigation Results</h3>
          <InvestigationPanel dossier={investigationDossier} />
        </div>
      )}
    </div>
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

type BadgeColor = "blue" | "slate" | "amber";

const badgeStyles: Record<BadgeColor, string> = {
  blue: "bg-blue-500/20 text-blue-300",
  slate: "bg-slate-700 text-slate-300",
  amber: "bg-amber-500/20 text-amber-300",
};

function Badge({ color, children }: { color: BadgeColor; children: React.ReactNode }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeStyles[color]}`}>
      {children}
    </span>
  );
}
