import type { Analysis } from "../../services/api";
import Section from "../ui/Section";
import InfoCard from "../ui/InfoCard";
import AiMetaStrip from "../whatson/AiMetaStrip";
import CitationPanel from "../CitationPanel";
import { FeedbackButtons } from "../FeedbackButtons";
import { StarRating } from "../StarRating";
import { InlineEditor } from "../InlineEditor";
import SentryBreadcrumbTimeline from "./SentryBreadcrumbTimeline";
import type { SentryFullData } from "./sentryTypes";

interface SentrySupportTabProps {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
  editableRootCause: string;
  onRootCauseSave: (v: string) => void;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function SentrySupportTab({
  analysis,
  sentryData,
  expanded,
  editableRootCause,
  onRootCauseSave,
}: SentrySupportTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const aiResult = sentryData?.aiResult;
  const sevColor =
    analysis.severity === "critical" ? "#ef4444" :
    analysis.severity === "high"     ? "#f59e0b" :
    analysis.severity === "medium"   ? "#3b82f6" : "#10b981";

  const eventCount = sentryData?.count ? parseInt(sentryData.count, 10) : null;
  const userCount  = sentryData?.userCount ?? null;

  // Condensed breadcrumbs for support view — last 8, highlight the error one
  const recentCrumbs = (sentryData?.breadcrumbs ?? []).slice(-8);

  const verdictText =
    aiResult?.user_impact ||
    aiResult?.error_message ||
    analysis.error_message ||
    null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Quick Stats */}
      <Section title="QUICK SUMMARY">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
          <InfoCard
            label="EVENTS"
            value={eventCount != null ? eventCount.toLocaleString() : "—"}
            accent="#f59e0b"
            sub={sentryData?.status?.toUpperCase()}
          />
          <InfoCard
            label="USERS AFFECTED"
            value={userCount != null ? String(userCount) : "—"}
            accent="#ef4444"
            sub={sentryData?.platform ?? undefined}
          />
          <InfoCard
            label="FIRST SEEN"
            value={formatDate(sentryData?.firstSeen)}
            accent="#6b7280"
            sub={formatDate(sentryData?.lastSeen) !== "—" ? `Last: ${formatDate(sentryData?.lastSeen)}` : undefined}
          />
          <InfoCard
            label="SEVERITY"
            value={analysis.severity.toUpperCase()}
            accent={sevColor}
            sub={analysis.confidence ?? undefined}
          />
        </div>

        {/* Sentry metadata bar */}
        {sentryData && (sentryData.shortId || sentryData.culprit) && (
          <div style={{
            marginTop: "10px", padding: "8px 12px", display: "flex", gap: "16px", flexWrap: "wrap",
            background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: "11px", fontFamily: mono,
          }}>
            {sentryData.shortId && (
              <span><span style={{ color: "#6b7280" }}>ID </span><span style={{ color: "#d1d5db" }}>{sentryData.shortId}</span></span>
            )}
            {sentryData.level && (
              <span><span style={{ color: "#6b7280" }}>LEVEL </span><span style={{ color: "#fca5a5" }}>{sentryData.level.toUpperCase()}</span></span>
            )}
            {sentryData.status && (
              <span><span style={{ color: "#6b7280" }}>STATUS </span><span style={{ color: "#d1d5db" }}>{sentryData.status}</span></span>
            )}
            {sentryData.culprit && (
              <span><span style={{ color: "#6b7280" }}>CULPRIT </span><span style={{ color: "#93c5fd" }}>{sentryData.culprit}</span></span>
            )}
          </div>
        )}
      </Section>

      {/* Verdict / User Impact */}
      {verdictText && (
        <Section title="WHAT HAPPENED">
          <div style={{
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
            borderLeft: "3px solid #ef4444", borderRadius: "6px", padding: "14px",
          }}>
            <div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
              {analysis.error_type || analysis.filename}
            </div>
            <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>{verdictText}</div>
          </div>
        </Section>
      )}

      {/* Root Cause */}
      <Section
        title="ROOT CAUSE"
        actions={
          <FeedbackButtons
            analysisId={analysis.id}
            fieldName="rootCause"
            currentValue={editableRootCause}
          />
        }
      >
        <InlineEditor
          analysisId={analysis.id}
          fieldName="rootCause"
          value={editableRootCause}
          onSave={onRootCauseSave}
        />
        {aiResult?.breadcrumb_analysis && (
          <div style={{
            marginTop: "10px", padding: "10px 14px",
            background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)",
            borderRadius: "6px",
          }}>
            <span style={{ color: "#f59e0b", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>TRIGGER </span>
            <span style={{ color: "#d1d5db", fontSize: "12px" }}>{aiResult.breadcrumb_analysis}</span>
          </div>
        )}
        {(aiResult?.component || sentryData?.culprit) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            {aiResult?.component && (
              <div style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "3px" }}>AFFECTED COMPONENT</div>
                <code style={{ color: "#93c5fd", fontSize: "12px", fontFamily: mono }}>{aiResult.component}</code>
              </div>
            )}
            {sentryData?.culprit && (
              <div style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "3px" }}>CULPRIT</div>
                <code style={{ color: "#c4b5fd", fontSize: "12px", fontFamily: mono }}>{sentryData.culprit}</code>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* User Journey / Breadcrumbs — condensed */}
      {recentCrumbs.length > 0 && (
        <Section title="USER JOURNEY (LAST 8 EVENTS)">
          <SentryBreadcrumbTimeline
            breadcrumbs={recentCrumbs}
            breadcrumbAnalysis={undefined}
          />
        </Section>
      )}

      {/* Similar Cases (expanded only) */}
      {expanded && (
        <Section title="SIMILAR CASES">
          <CitationPanel
            query={`${analysis.error_type ?? ""} ${analysis.component ?? ""} ${analysis.stack_trace?.slice(0, 200) ?? ""}`}
            component={analysis.component}
            severity={analysis.severity?.toLowerCase()}
            onCitationClick={() => {}}
            defaultCollapsed={false}
          />
        </Section>
      )}

      {/* Analysis Quality */}
      <Section title="ANALYSIS QUALITY">
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "8px", padding: "14px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginBottom: "3px" }}>How was this analysis?</div>
            <div style={{ color: "#6b7280", fontSize: "12px" }}>Your feedback improves future results</div>
          </div>
          <StarRating analysisId={analysis.id} size="large" />
        </div>
      </Section>

      <AiMetaStrip analysis={analysis} />
    </div>
  );
}
