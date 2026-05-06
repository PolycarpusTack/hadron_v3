/**
 * Sentry Detail View — 4-tab redesign
 * Action / Overview / Technical / Monitoring
 */

import { useState, useEffect } from "react";
import { invoke } from "../../lib/tauri-core-shim";
import { openExternal as open } from "../../utils/openExternal";
import { format } from "date-fns";
import logger from "../../services/logger";
import { ArrowLeft, ChevronRight, Download, ExternalLink, Ticket } from "lucide-react";
import type { Analysis } from "../../services/api";
import { isJiraEnabled } from "../../services/jira";
import JiraTicketModal from "../JiraTicketModal";
import { GoldBadge } from "../GoldBadge";
import ExportDialog from "../ExportDialog";
import type { ExportSource } from "../../types";
import { parseSentryFullData } from "./sentryTypes";

import SentryActionTab     from "./SentryActionTab";
import SentryOverviewTab   from "./SentryOverviewTab";
import SentryTechnicalTab  from "./SentryTechnicalTab";
import SentryMonitoringTab from "./SentryMonitoringTab";

interface SentryDetailViewProps {
  analysis: Analysis;
  onBack: () => void;
}

type TabId = "action" | "overview" | "technical" | "monitoring";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "action",     label: "Support / Action", icon: "◎" },
  { id: "overview",   label: "Issue Overview",   icon: "◉" },
  { id: "technical",  label: "Technical",        icon: "⌘" },
  { id: "monitoring", label: "Monitoring",        icon: "⊡" },
];

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f59e0b",
  medium:   "#3b82f6",
  low:      "#10b981",
};

function getSevColor(s: string) {
  return SEV_COLOR[s?.toLowerCase()] ?? "#6b7280";
}

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'IBM Plex Sans',-apple-system,sans-serif";

export default function SentryDetailView({ analysis, onBack }: SentryDetailViewProps) {
  const [tab, setTab]                     = useState<TabId>("action");
  const [expanded, setExpanded]           = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [jiraEnabled, setJiraEnabled]     = useState(false);
  const [isGold, setIsGold]               = useState(false);
  const [showExport, setShowExport]       = useState(false);

  const sentryData = parseSentryFullData(analysis.full_data);
  const aiResult   = sentryData?.aiResult;
  const sevColor   = getSevColor(analysis.severity);

  const firstEx = sentryData?.exceptions?.[0];
  const exType  = firstEx?.exception_type ?? analysis.error_type ?? "";
  const exValue = firstEx?.value ?? analysis.error_message ?? "";

  useEffect(() => { isJiraEnabled().then(setJiraEnabled); }, []);
  useEffect(() => {
    invoke<boolean>("is_gold_analysis", { analysisId: analysis.id })
      .then(setIsGold)
      .catch(err => logger.error("Failed to check gold status", { error: String(err) }));
  }, [analysis.id]);

  function buildExportSource(): ExportSource {
    const fixContent = Array.isArray(aiResult?.suggested_fixes)
      ? aiResult!.suggested_fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : typeof analysis.suggested_fixes === "string" ? analysis.suggested_fixes : "";

    const sections: ExportSource["sections"] = [
      {
        id: "summary", label: "Summary", defaultOn: true,
        content: [
          `Error Type: ${analysis.error_type}`,
          `Severity: ${analysis.severity}`,
          sentryData?.shortId ? `Sentry ID: ${sentryData.shortId}` : "",
          sentryData?.permalink ? `URL: ${sentryData.permalink}` : "",
          sentryData?.count ? `Events: ${sentryData.count}` : "",
          sentryData?.userCount ? `Users: ${sentryData.userCount}` : "",
        ].filter(Boolean).join("\n"),
      },
      { id: "root_cause",      label: "Root Cause",      content: aiResult?.root_cause || analysis.root_cause || "—", defaultOn: true },
      { id: "suggested_fixes", label: "Suggested Fixes", content: fixContent || "None",                                defaultOn: true },
    ];
    if (aiResult?.user_impact) {
      sections.push({ id: "user_impact", label: "User Impact", content: aiResult.user_impact, defaultOn: true });
    }
    if (analysis.stack_trace) {
      sections.push({ id: "stack_trace", label: "Stack Trace", content: analysis.stack_trace, defaultOn: false });
    }
    return {
      sourceType: "sentry",
      sourceName: analysis.filename,
      defaultTitle: `Sentry Analysis: ${analysis.filename}`,
      sections,
    };
  }

  return (
    <div style={{ fontFamily: SANS, display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* ── Header bar ───────────────────────────────────────────── */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "10px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px",
        background: "rgba(255,255,255,0.01)",
      }}>
        {/* Left: breadcrumb + issue meta */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <nav style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
            <button
              onClick={onBack}
              style={{ display: "flex", alignItems: "center", gap: "4px", color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "13px" }}
            >
              <ArrowLeft style={{ width: 13, height: 13 }} />
              History
            </button>
            <ChevronRight style={{ width: 11, height: 11, color: "#374151" }} />
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#f97316" }} />
            <span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 700, fontFamily: MONO }}>
              {sentryData?.shortId ?? analysis.filename}
            </span>
          </div>

          {sentryData?.status && (
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO, color: "#9ca3af", background: "rgba(255,255,255,0.04)", padding: "2px 6px", borderRadius: "3px" }}>
              {sentryData.status.toUpperCase()}
            </span>
          )}
          {sentryData?.count && (
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO, color: "#f97316", background: "rgba(249,115,22,0.1)", padding: "2px 6px", borderRadius: "3px" }}>
              {parseInt(sentryData.count, 10).toLocaleString()} events
            </span>
          )}
          {sentryData?.userCount != null && sentryData.userCount > 0 && (
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO, color: "#c4b5fd", background: "rgba(139,92,246,0.1)", padding: "2px 6px", borderRadius: "3px" }}>
              {sentryData.userCount} users
            </span>
          )}
          {sentryData?.culprit && (
            <>
              <span style={{ color: "#4b5563" }}>│</span>
              <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: MONO, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {sentryData.culprit}
              </span>
            </>
          )}

          <GoldBadge analysisId={analysis.id} isGold={isGold} onPromoted={() => setIsGold(true)} />
        </div>

        {/* Right: action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowExport(true)}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "5px", fontSize: "11px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", cursor: "pointer" }}
          >
            <Download style={{ width: 12, height: 12 }} /> Export
          </button>
          {jiraEnabled && (
            <button
              onClick={() => setShowJiraModal(true)}
              style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "5px", fontSize: "11px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981", cursor: "pointer" }}
            >
              <Ticket style={{ width: 12, height: 12 }} /> Create JIRA
            </button>
          )}
          {sentryData?.permalink && (
            <button
              onClick={() => open(sentryData.permalink!)}
              style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "5px", fontSize: "11px", background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", color: "#fb923c", cursor: "pointer" }}
            >
              <ExternalLink style={{ width: 12, height: 12 }} /> Sentry
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              padding: "5px 12px", borderRadius: "5px", fontSize: "11px", fontWeight: 600,
              fontFamily: MONO, letterSpacing: ".06em",
              background: expanded ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${expanded ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.1)"}`,
              color: expanded ? "#c4b5fd" : "#9ca3af",
              cursor: "pointer",
            }}
          >
            {expanded ? "◉ Expanded" : "○ Standard"}
          </button>
        </div>
      </div>

      {/* ── Exception banner ─────────────────────────────────────── */}
      {(exType || exValue) && (
        <div style={{
          padding: "8px 20px",
          background: "rgba(239,68,68,0.04)", borderBottom: "1px solid rgba(239,68,68,0.1)",
          display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
        }}>
          <span style={{ color: "#ef4444", fontSize: "12px", fontFamily: MONO, fontWeight: 700, flexShrink: 0 }}>{exType}</span>
          {exType && exValue && <span style={{ color: "#4b5563" }}>—</span>}
          <span style={{ color: "#fca5a5", fontSize: "12px", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exValue}</span>
          {analysis.analyzed_at && (
            <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: MONO, flexShrink: 0 }}>
              {format(new Date(analysis.analyzed_at), "MMM d, yyyy")} · {analysis.ai_model} · ${analysis.cost.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* ── Severity strip ───────────────────────────────────────── */}
      <div style={{ height: "3px", background: sevColor, opacity: 0.7 }} />

      {/* ── Tab navigation ───────────────────────────────────────── */}
      <div style={{
        display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "0 20px", background: "rgba(255,255,255,0.01)",
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none", border: "none",
              padding: "10px 16px",
              color: tab === t.id ? "#e5e7eb" : "#6b7280",
              fontSize: "12px", cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid #f97316" : "2px solid transparent",
              fontFamily: SANS, fontWeight: tab === t.id ? 600 : 400,
              display: "flex", alignItems: "center", gap: "5px",
              marginBottom: "-1px", transition: "color .15s", whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: "11px", opacity: tab === t.id ? 1 : 0.5 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div style={{ padding: "20px", overflow: "auto" }}>
        <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
        {tab === "action" && (
          <SentryActionTab analysis={analysis} sentryData={sentryData} expanded={expanded} />
        )}
        {tab === "overview" && (
          <SentryOverviewTab analysis={analysis} sentryData={sentryData} expanded={expanded} />
        )}
        {tab === "technical" && (
          <SentryTechnicalTab analysis={analysis} sentryData={sentryData} expanded={expanded} />
        )}
        {tab === "monitoring" && (
          <SentryMonitoringTab analysis={analysis} sentryData={sentryData} expanded={expanded} />
        )}
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      <JiraTicketModal analysis={analysis} isOpen={showJiraModal} onClose={() => setShowJiraModal(false)} />
      <ExportDialog source={buildExportSource()} isOpen={showExport} onClose={() => setShowExport(false)} />
    </div>
  );
}
