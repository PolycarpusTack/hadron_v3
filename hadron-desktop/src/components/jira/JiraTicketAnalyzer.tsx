/**
 * JIRA Ticket Analyzer
 * Tab 1: Paste a JIRA key/URL, fetch and preview the ticket, then analyze with AI.
 */

import { useState } from "react";
import { openExternal as open } from "../../utils/openExternal";
import {
  Search,
  ExternalLink,
  AlertCircle,
  Loader2,
  Zap,
  FlaskConical,
  Microscope,
  Tag,
  Clock,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Info,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  BookOpen,
  Download,
} from "lucide-react";
import Button from "../ui/Button";
import ExportDialog from "../ExportDialog";
import type { ExportSource } from "../../types";
import JiraImportService, { type NormalizedIssue } from "../../services/jira-import";
import { analyzeJiraTicket, getAnalysisById, getStoredApiKey } from "../../services/api";
import { getStoredModel, getStoredProvider } from "../../services/api";
import type { Analysis } from "../../services/api";
import { analyzeJiraTicketDeep, type JiraDeepResult } from "../../services/api";
import JiraAnalysisReport from "./JiraAnalysisReport";
import { triageJiraTicket, getTicketBrief, generateTicketBrief, type JiraTriageResult, type JiraBriefResult, type TicketBrief } from "../../services/jira-assist";
import { getJiraConfig } from "../../services/jira";
import { getApiKey } from "../../services/secure-storage";
import TriageBadgePanel from "./TriageBadgePanel";
import TicketBriefPanel from "./TicketBriefPanel";
import { getStatusColor, getPriorityColor, formatRelativeTime } from "./jiraHelpers";
import { isKBEnabled, getOpenSearchConfig } from "../../services/opensearch";
import { isRagAvailable } from "../../services/rag";
import { investigateTicket, type InvestigationDossier } from "../../services/investigation";
import { InvestigationPanel } from "./InvestigationPanel";

interface JiraTicketAnalyzerProps {
  onAnalysisComplete: (analysis: Analysis) => void;
}

export default function JiraTicketAnalyzer({ onAnalysisComplete }: JiraTicketAnalyzerProps) {
  const [input, setInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<NormalizedIssue | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [deepAnalyzing, setDeepAnalyzing] = useState(false);
  const [deepResult, setDeepResult] = useState<{
    id: number;
    result: JiraDeepResult;
  } | null>(null);
  const [triaging, setTriaging] = useState(false);
  const [triageResult, setTriageResult] = useState<JiraTriageResult | null>(null);
  const [triageFromCache, setTriageFromCache] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [briefResult, setBriefResult] = useState<JiraBriefResult | null>(null);
  const [briefFromCache, setBriefFromCache] = useState(false);
  const [storedBrief, setStoredBrief] = useState<TicketBrief | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [investigationDossier, setInvestigationDossier] = useState<InvestigationDossier | null>(null);
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  async function handleFetch() {
    const trimmed = input.trim();
    if (!trimmed) return;

    setFetching(true);
    setError(null);
    setIssue(null);
    setShowFullDescription(false);

    try {
      const key = JiraImportService.parseJiraKeyOrUrl(trimmed);
      if (!key) {
        setError("Invalid JIRA key or URL. Expected PROJ-123 or a JIRA browse URL.");
        return;
      }

      const result = await JiraImportService.fetchSingleIssue(key);
      if (result.success && result.issue) {
        setIssue(result.issue);
        // Load any previously stored triage + brief for this ticket (single DB call)
        setTriageResult(null);
        setTriageFromCache(false);
        setBriefResult(null);
        setBriefFromCache(false);
        setStoredBrief(null);
        try {
          const stored = await getTicketBrief(result.issue.key);
          if (stored) setStoredBrief(stored);
          if (stored?.triage_json) {
            const parsed: JiraTriageResult = JSON.parse(stored.triage_json);
            setTriageResult(parsed);
            setTriageFromCache(true);
          }
          if (stored?.brief_json) {
            const parsed: JiraBriefResult = JSON.parse(stored.brief_json);
            setBriefResult(parsed);
            setBriefFromCache(true);
          }
        } catch {
          // No stored data — that's fine
        }
        // Load JIRA creds for Post to JIRA feature
        try {
          const cfg = await getJiraConfig();
          setJiraBaseUrl(cfg.baseUrl);
          setJiraEmail(cfg.email);
          const token = await getApiKey("jira");
          setJiraApiToken(token ?? "");
        } catch {
          // JIRA not configured — Post button will be disabled
        }
      } else {
        setError(result.error || "Failed to fetch issue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  async function refreshBrief(jiraKey: string) {
    try {
      const stored = await getTicketBrief(jiraKey);
      if (stored) setStoredBrief(stored);
    } catch {
      // Ignore
    }
  }

  async function handleAnalyze() {
    if (!issue) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);

      // Check if RAG is available
      let useRag = false;
      try { useRag = await isRagAvailable(); } catch { /* continue without */ }

      // Check if KB integration is enabled
      let kbOptions: { useKB?: boolean; customer?: string; wonVersion?: string; kbMode?: string } | undefined;
      try {
        const kbEnabled = await isKBEnabled();
        if (kbEnabled) {
          const kbConfig = await getOpenSearchConfig();
          kbOptions = {
            useKB: true,
            customer: kbConfig.defaultCustomer || undefined,
            wonVersion: kbConfig.defaultVersion || undefined,
            kbMode: kbConfig.mode === "both" ? "remote" : kbConfig.mode,
          };
        }
      } catch {
        // KB check failed, continue without KB
      }

      const result = await analyzeJiraTicket(
        issue.key,
        issue.summary,
        issue.descriptionPlaintext || "",
        commentTexts,
        issue.priority || undefined,
        issue.status || undefined,
        issue.components,
        issue.labels,
        apiKey,
        getStoredModel(),
        getStoredProvider(),
        useRag || undefined,
        kbOptions,
      );
      const fullAnalysis = await getAnalysisById(result.id);
      onAnalysisComplete(fullAnalysis);
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDeepAnalyze() {
    if (!issue) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setDeepAnalyzing(true);
    setDeepResult(null);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);
      const response = await analyzeJiraTicketDeep(
        issue.key,
        issue.summary,
        issue.descriptionPlaintext || "",
        issue.issueType || "Unknown",
        issue.priority || undefined,
        issue.status || undefined,
        issue.components,
        issue.labels,
        commentTexts,
        apiKey,
        getStoredModel(),
        getStoredProvider(),
      );
      setDeepResult({ id: response.id, result: response.result });
    } catch (err) {
      setError(`Deep analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeepAnalyzing(false);
    }
  }

  async function handleInvestigate() {
    if (!issue) return;
    setInvestigating(true);
    setInvestigationError(null);
    setInvestigationDossier(null);
    try {
      const dossier = await investigateTicket(issue.key);
      setInvestigationDossier(dossier);
    } catch (err) {
      setInvestigationError(err instanceof Error ? err.message : String(err));
    } finally {
      setInvestigating(false);
    }
  }

  async function handleTriage() {
    if (!issue) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setTriaging(true);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);
      const result = await triageJiraTicket({
        jiraKey: issue.key,
        title: issue.summary,
        description: issue.descriptionPlaintext || "",
        issueType: issue.issueType || "Unknown",
        priority: issue.priority || undefined,
        status: issue.status || undefined,
        components: issue.components,
        labels: issue.labels,
        comments: commentTexts,
        apiKey,
        model: getStoredModel(),
        provider: getStoredProvider(),
      });
      setTriageResult(result);
      setTriageFromCache(false);
    } catch (err) {
      setError(`Triage failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTriaging(false);
    }
  }

  async function handleGenerateBrief() {
    if (!issue) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setBriefing(true);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);
      const result = await generateTicketBrief({
        jiraKey:     issue.key,
        title:       issue.summary,
        description: issue.descriptionPlaintext || "",
        issueType:   issue.issueType || "Unknown",
        priority:    issue.priority || undefined,
        status:      issue.status || undefined,
        components:  issue.components,
        labels:      issue.labels,
        comments:    commentTexts,
        apiKey,
        model:    getStoredModel(),
        provider: getStoredProvider(),
      });
      setBriefResult(result);
      setBriefFromCache(false);
      // Also sync triage result from the brief (brief includes a fresh triage)
      setTriageResult(result.triage);
      setTriageFromCache(false);
    } catch (err) {
      setError(`Brief generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBriefing(false);
    }
  }

  function buildJiraExportSource(
    iss: NormalizedIssue,
    triage: JiraTriageResult | null,
    brief: JiraBriefResult | null,
    deep: JiraDeepResult | null,
  ): ExportSource {
    const sections: (ExportSource["sections"][number])[] = [];

    // Ticket Summary — always present
    const ticketLines = [
      `Key: ${iss.key}`,
      `Summary: ${iss.summary}`,
      `Type: ${iss.issueType || "Unknown"}`,
      `Priority: ${iss.priority || "Not set"}`,
      `Status: ${iss.status || "Unknown"}`,
      iss.components.length > 0 ? `Components: ${iss.components.join(", ")}` : null,
      iss.labels.length > 0 ? `Labels: ${iss.labels.join(", ")}` : null,
      iss.assignee ? `Assignee: ${iss.assignee.displayName}` : null,
    ].filter(Boolean).join("\n");
    sections.push({ id: "ticket", label: "Ticket Summary", content: ticketLines, defaultOn: true });

    // Triage — from brief or standalone triage
    const triageData = brief?.triage ?? triage;
    if (triageData) {
      const triageLines = [
        `Severity: ${triageData.severity}`,
        `Category: ${triageData.category}`,
        `Confidence: ${triageData.confidence}`,
        `Customer Impact: ${triageData.customer_impact}`,
        triageData.tags.length > 0 ? `Tags: ${triageData.tags.join(", ")}` : null,
        `Rationale: ${triageData.rationale}`,
      ].filter(Boolean).join("\n");
      sections.push({ id: "triage", label: "Triage", content: triageLines, defaultOn: true });
    }

    // Use deep analysis from brief or standalone
    const analysis = brief?.analysis ?? deep;

    if (analysis) {
      // Analysis Summary
      sections.push({
        id: "summary",
        label: "Analysis Summary",
        content: analysis.plain_summary,
        defaultOn: true,
      });

      // Technical Analysis
      const tech = analysis.technical;
      const techLines = [
        `Error Type: ${tech.error_type}`,
        `Root Cause: ${tech.root_cause}`,
        `Affected Areas: ${tech.affected_areas.join(", ")}`,
        `Severity Estimate: ${tech.severity_estimate}`,
        `Confidence: ${tech.confidence} — ${tech.confidence_rationale}`,
      ].join("\n");
      sections.push({ id: "technical", label: "Technical Analysis", content: techLines, defaultOn: true });

      // Recommended Actions
      if (analysis.recommended_actions.length > 0) {
        const actionsText = analysis.recommended_actions
          .map((a, i) => `${i + 1}. [${a.priority}] ${a.action}\n   Rationale: ${a.rationale}`)
          .join("\n\n");
        sections.push({ id: "actions", label: "Recommended Actions", content: actionsText, defaultOn: true });
      }

      // Risk & Impact
      const risk = analysis.risk;
      const riskLines = [
        `User Impact: ${risk.user_impact}`,
        `Blast Radius: ${risk.blast_radius}`,
        `Urgency: ${risk.urgency}`,
        `Do-Nothing Risk: ${risk.do_nothing_risk}`,
      ].join("\n");
      sections.push({ id: "risk", label: "Risk & Impact", content: riskLines, defaultOn: false });

      // Open Questions
      if (analysis.open_questions.length > 0) {
        const questionsText = analysis.open_questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
        sections.push({ id: "questions", label: "Open Questions", content: questionsText, defaultOn: false });
      }
    }

    return {
      sourceType: "jira",
      sourceName: iss.key,
      defaultTitle: `${iss.key} — ${iss.summary}`,
      sections,
    };
  }

  function handleReset() {
    setIssue(null);
    setInput("");
    setError(null);
    setShowFullDescription(false);
    setTriageResult(null);
    setTriageFromCache(false);
    setBriefResult(null);
    setBriefFromCache(false);
  }

  return (
    <div className="space-y-4">
      {/* Input Bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !fetching && !analyzing) handleFetch();
            }}
            placeholder="Paste JIRA ticket key (PROJ-123) or URL..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-sky-500 transition"
            disabled={fetching || analyzing}
          />
        </div>
        <Button
          onClick={handleFetch}
          disabled={analyzing || !input.trim()}
          loading={fetching}
          size="lg"
          icon={<Search />}
          className="bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600"
        >
          {fetching ? "Fetching..." : "Fetch"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Progress indicator during analysis */}
      {analyzing && (
        <div className="flex items-center gap-3 p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
          <div>
            <p className="text-sm text-sky-300 font-medium">Analyzing {issue?.key}...</p>
            <p className="text-xs text-gray-400">Running AI analysis on ticket content</p>
          </div>
        </div>
      )}
      {deepAnalyzing && (
        <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
          <div>
            <p className="text-sm text-purple-300 font-medium">
              Deep analyzing {issue?.key}...
            </p>
            <p className="text-xs text-gray-400">
              Running JIRA-specific analysis with structured output
            </p>
          </div>
        </div>
      )}
      {triaging && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Triaging {issue?.key}...</p>
            <p className="text-xs text-gray-400">Classifying severity, category, and impact</p>
          </div>
        </div>
      )}
      {briefing && (
        <div className="flex items-center gap-3 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
          <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          <div>
            <p className="text-sm text-indigo-300 font-medium">Generating brief for {issue?.key}...</p>
            <p className="text-xs text-gray-400">Running triage + deep analysis in parallel</p>
          </div>
        </div>
      )}

      {/* Issue Preview Card */}
      {issue && !analyzing && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-700">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sky-400 text-sm font-medium">
                    {issue.key}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(issue.status)}`}>
                    {issue.status}
                  </span>
                  <span className={`text-xs ${getPriorityColor(issue.priority)}`}>
                    {issue.priority}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white leading-snug">
                  {issue.summary}
                </h3>
              </div>
              <Button
                onClick={() => open(issue.url)}
                variant="secondary"
                size="sm"
                icon={<ExternalLink />}
                className="flex-shrink-0"
              >
                Open in JIRA
              </Button>
            </div>

            {/* Metadata Row */}
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {issue.issueType}
              </span>
              {issue.assignee && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {issue.assignee.displayName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated {formatRelativeTime(issue.updatedAt)}
              </span>
              {issue.comments.length > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {issue.comments.length} comment{issue.comments.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Labels & Components */}
          {(issue.labels.length > 0 || issue.components.length > 0) && (
            <div className="px-5 py-3 border-b border-gray-700 flex flex-wrap gap-1.5">
              {issue.components.map((c) => (
                <span key={c} className="px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded text-xs text-sky-300">
                  {c}
                </span>
              ))}
              {issue.labels.map((l) => (
                <span key={l} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {issue.descriptionPlaintext && (
            <div className="px-5 py-4 border-b border-gray-700">
              <div className={`text-sm text-gray-300 whitespace-pre-wrap ${!showFullDescription ? "line-clamp-6" : ""}`}>
                {issue.descriptionPlaintext}
              </div>
              {issue.descriptionPlaintext.length > 400 && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="mt-2 text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  {showFullDescription ? (
                    <>
                      <ChevronUp className="w-3 h-3" /> Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" /> Show full description
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Error Signatures */}
          {issue.extractedSignatures.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-700">
              <span className="text-xs text-gray-500 block mb-1.5">Detected Error Signatures</span>
              <div className="flex flex-wrap gap-1.5">
                {issue.extractedSignatures.slice(0, 5).map((sig, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 font-mono"
                  >
                    {sig.length > 60 ? sig.substring(0, 57) + "..." : sig}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Analysis Sources Box */}
          <AnalysisSourcesBox issue={issue} />

          {/* Quality Warning Banner */}
          <QualityWarningBanner issue={issue} />

          {/* Action Bar */}
          <div className="px-5 py-4 flex items-center justify-between">
            <Button
              onClick={handleReset}
              variant="ghost"
            >
              Clear & start over
            </Button>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleTriage}
                loading={triaging}
                size="lg"
                icon={<ShieldAlert />}
                className="bg-amber-700 hover:bg-amber-600 font-semibold px-5"
                disabled={analyzing || deepAnalyzing || briefing}
              >
                {triaging ? "Triaging..." : "Triage"}
              </Button>
              <Button
                onClick={handleGenerateBrief}
                loading={briefing}
                size="lg"
                icon={<BookOpen />}
                className="bg-indigo-700 hover:bg-indigo-600 font-semibold px-5"
                disabled={analyzing || deepAnalyzing || triaging}
              >
                {briefing ? "Generating..." : "Generate Brief"}
              </Button>
              <Button
                onClick={handleAnalyze}
                loading={analyzing}
                size="lg"
                icon={<Zap />}
                className="bg-sky-600 hover:bg-sky-700 font-semibold px-5"
                disabled={deepAnalyzing || triaging || briefing}
              >
                {analyzing ? "Analyzing..." : "Analyze with AI"}
              </Button>
              <Button
                onClick={handleDeepAnalyze}
                loading={deepAnalyzing}
                size="lg"
                icon={<Microscope />}
                className="bg-purple-700 hover:bg-purple-600 font-semibold px-5"
                disabled={analyzing || triaging || briefing || investigating}
              >
                {deepAnalyzing ? "Deep Analyzing..." : "Deep Analyze"}
              </Button>
              <Button
                onClick={handleInvestigate}
                loading={investigating}
                size="lg"
                icon={<FlaskConical />}
                className="bg-teal-700 hover:bg-teal-600 font-semibold px-5"
                disabled={analyzing || deepAnalyzing || triaging || briefing}
              >
                {investigating ? "Investigating…" : "Investigate"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowExport(true)}
                disabled={!triageResult && !briefResult && !deepResult}
                icon={<Download />}
              >
                Export
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Triage Badge Panel */}
      {triageResult && !triaging && issue && (
        <TriageBadgePanel result={triageResult} fromCache={triageFromCache} />
      )}

      {/* Investigation Brief Panel */}
      {briefResult && !briefing && issue && (
        <TicketBriefPanel
          jiraKey={issue.key}
          title={issue.summary}
          description={issue.descriptionPlaintext || ""}
          result={briefResult}
          fromCache={briefFromCache}
          briefJson={storedBrief?.brief_json ?? null}
          postedToJira={storedBrief?.posted_to_jira ?? false}
          postedAt={storedBrief?.posted_at ?? null}
          engineerRating={storedBrief?.engineer_rating ?? null}
          engineerNotes={storedBrief?.engineer_notes ?? null}
          jiraBaseUrl={jiraBaseUrl}
          jiraEmail={jiraEmail}
          jiraApiToken={jiraApiToken}
          onBriefUpdated={() => refreshBrief(issue.key)}
        />
      )}

      {/* Deep Analysis Report */}
      {deepResult && !deepAnalyzing && issue && (
        <JiraAnalysisReport
          analysisId={deepResult.id}
          jiraKey={issue.key}
          result={deepResult.result}
          category={triageResult?.category || storedBrief?.category || undefined}
          onViewInHistory={async (id) => {
            try {
              const fullAnalysis = await getAnalysisById(id);
              onAnalysisComplete(fullAnalysis);
            } catch {
              // Navigation failed — report is still shown inline
            }
          }}
        />
      )}

      {/* Investigation Results */}
      {investigationError && (
        <div className="rounded-lg bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-300 mx-4 mt-4">
          Investigation failed: {investigationError}
        </div>
      )}
      {investigationDossier && !investigating && (
        <div className="mx-4 mt-4 mb-2">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Investigation Results</h3>
          <InvestigationPanel dossier={investigationDossier} />
        </div>
      )}

      {/* Export Dialog */}
      {issue && (
        <ExportDialog
          source={buildJiraExportSource(issue, triageResult, briefResult, deepResult?.result ?? null)}
          isOpen={showExport}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Empty state */}
      {!issue && !fetching && !error && (
        <div className="text-center py-16 text-gray-500">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Paste a JIRA ticket key or URL above to get started</p>
          <p className="text-xs mt-1 text-gray-600">
            e.g. PROJ-123 or https://company.atlassian.net/browse/PROJ-123
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Ticket Quality Scorer
// ============================================================================

interface QualityResult {
  score: number;
  suggestions: string[];
}

function scoreTicketQuality(issue: NormalizedIssue): QualityResult {
  let score = 0;
  const suggestions: string[] = [];

  // Description >100 chars: +25pts
  if ((issue.descriptionPlaintext?.length ?? 0) > 100) {
    score += 25;
  } else {
    suggestions.push("Add a detailed description (>100 characters) for better analysis");
  }

  // >=1 comment: +15pts
  if (issue.comments.length >= 1) {
    score += 15;
  } else {
    suggestions.push("Comments with reproduction steps or error details improve results");
  }

  // Error signatures detectable: +20pts
  if (issue.extractedSignatures.length > 0) {
    score += 20;
  } else {
    suggestions.push("Include error messages or stack traces in the description");
  }

  // Components specified: +10pts
  if (issue.components.length > 0) {
    score += 10;
  } else {
    suggestions.push("Add components to help identify the affected module");
  }

  // Labels present: +5pts
  if (issue.labels.length > 0) {
    score += 5;
  }

  // Priority set (not "None"): +10pts
  if (issue.priority && issue.priority !== "None") {
    score += 10;
  }

  // Status set: +5pts
  if (issue.status) {
    score += 5;
  }

  // Environment/version detectable: +10pts
  const envRegex = /(?:version|v\d|environment|env|release|build)\s*[:=]?\s*\S+/i;
  const fullText = `${issue.descriptionPlaintext ?? ""} ${issue.comments.map(c => c.body).join(" ")}`;
  if (envRegex.test(fullText)) {
    score += 10;
  }

  return { score, suggestions };
}

function QualityWarningBanner({ issue }: { issue: NormalizedIssue }) {
  const { score, suggestions } = scoreTicketQuality(issue);

  if (score >= 40) return null;

  return (
    <div className="mx-5 mb-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-300">
            Low data quality (score: {score}/100)
          </p>
          <p className="text-xs text-gray-400 mt-0.5 mb-2">
            The AI may produce less accurate results. Consider enriching the ticket:
          </p>
          <ul className="space-y-0.5">
            {suggestions.map((s, i) => (
              <li key={i} className="text-xs text-amber-400/80 flex items-start gap-1.5">
                <span className="text-amber-500 mt-0.5">-</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Analysis Sources Box — shows what data the AI will receive
// ============================================================================

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function AnalysisSourcesBox({ issue }: { issue: NormalizedIssue }) {
  const [expanded, setExpanded] = useState(false);

  const descWords = wordCount(issue.descriptionPlaintext);
  const commentWords = issue.comments.reduce((sum, c) => sum + wordCount(c.body), 0);
  const totalWords = wordCount(issue.summary) + descWords + commentWords;

  // Build source entries: icon, label, detail, present?
  const sources: { label: string; detail: string; present: boolean }[] = [
    { label: "Summary", detail: issue.summary.length > 80 ? issue.summary.substring(0, 77) + "..." : issue.summary, present: true },
    { label: "Description", detail: descWords > 0 ? `${descWords.toLocaleString()} words` : "empty", present: descWords > 0 },
    { label: "Comments", detail: issue.comments.length > 0 ? `${issue.comments.length} comment${issue.comments.length !== 1 ? "s" : ""} (${commentWords.toLocaleString()} words)` : "none", present: issue.comments.length > 0 },
    { label: "Priority", detail: issue.priority || "not set", present: !!issue.priority },
    { label: "Status", detail: issue.status, present: !!issue.status },
    { label: "Components", detail: issue.components.length > 0 ? issue.components.join(", ") : "none", present: issue.components.length > 0 },
    { label: "Labels", detail: issue.labels.length > 0 ? issue.labels.join(", ") : "none", present: issue.labels.length > 0 },
  ];

  const presentCount = sources.filter((s) => s.present).length;

  return (
    <div className="mx-5 mb-1 rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-sky-500/10 transition"
      >
        <div className="flex items-center gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-sky-300 font-medium">Analysis Sources</span>
          <span className="text-gray-500">
            {presentCount} fields &middot; ~{totalWords.toLocaleString()} words sent to AI
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            The AI receives a structured document composed from the ticket fields below.
            It analyzes the content for error patterns, root causes, and actionable fixes
            using the same pipeline as the Crash Analyzer.
          </p>

          <div className="space-y-1">
            {sources.map((src) => (
              <div key={src.label} className="flex items-start gap-2 text-xs">
                {src.present ? (
                  <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-gray-600 mt-0.5 flex-shrink-0" />
                )}
                <span className={`font-medium w-20 flex-shrink-0 ${src.present ? "text-gray-300" : "text-gray-600"}`}>
                  {src.label}
                </span>
                <span className={src.present ? "text-gray-400" : "text-gray-600"}>
                  {src.detail}
                </span>
              </div>
            ))}
          </div>

          {issue.extractedSignatures.length > 0 && (
            <p className="text-xs text-gray-500 pt-1 border-t border-gray-700/50">
              {issue.extractedSignatures.length} error signature{issue.extractedSignatures.length !== 1 ? "s" : ""} were
              auto-detected from the ticket content. These are shown above but not sent separately —
              they are already part of the description and comments.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
