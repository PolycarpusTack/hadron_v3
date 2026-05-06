import type { Analysis } from "../../services/api";
import Section from "../ui/Section";
import InfoCard from "../ui/InfoCard";
import type { SentryFullData } from "./sentryTypes";

interface SentryExecutiveTabProps {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function KpiCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0, padding: "16px 18px",
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "8px", display: "flex", flexDirection: "column", gap: "4px",
    }}>
      <div style={{ color, fontSize: "24px", fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ color: "#9ca3af", fontSize: "11px", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      {sub && <div style={{ color: "#6b7280", fontSize: "11px" }}>{sub}</div>}
    </div>
  );
}

const PRIORITY_TIMELINE: Array<{ priority: string; label: string; color: string }> = [
  { priority: "P0", label: "Immediate / Today",  color: "#ef4444" },
  { priority: "P1", label: "This Sprint",        color: "#f59e0b" },
  { priority: "P2", label: "Next Quarter",       color: "#3b82f6" },
];

export default function SentryExecutiveTab({
  analysis,
  sentryData,
  expanded,
}: SentryExecutiveTabProps) {
  const aiResult = sentryData?.aiResult;
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";

  const sev = analysis.severity?.toLowerCase() ?? "unknown";
  const sevColor =
    sev === "critical" ? "#ef4444" :
    sev === "high"     ? "#f59e0b" :
    sev === "medium"   ? "#3b82f6" : "#10b981";

  const eventCount = sentryData?.count ? parseInt(sentryData.count, 10) : null;
  const userCount  = sentryData?.userCount ?? null;

  // Trend label based on first/last seen spread
  let trendLabel = "Active";
  if (sentryData?.firstSeen && sentryData.lastSeen) {
    const days = Math.round(
      (new Date(sentryData.lastSeen).getTime() - new Date(sentryData.firstSeen).getTime()) / 86_400_000
    );
    trendLabel = days <= 1 ? "New" : `${days}d active`;
  }

  // Fix availability heuristic
  let fixStatus = "Under investigation";
  let fixColor = "#6b7280";
  if (aiResult?.suggested_fixes?.length || analysis.suggested_fixes) {
    fixStatus = "Fix identified";
    fixColor = "#f59e0b";
  }

  // Summary for executives
  const summary =
    aiResult?.user_impact ||
    aiResult?.error_message ||
    analysis.error_message ||
    null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Severity headline */}
      <div style={{
        padding: "20px", borderRadius: "8px",
        background: `${sevColor}08`,
        border: `1px solid ${sevColor}22`,
        borderLeft: `4px solid ${sevColor}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div style={{
            padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 700,
            fontFamily: mono, background: `${sevColor}18`, color: sevColor, letterSpacing: ".08em",
          }}>
            {sev.toUpperCase()}
          </div>
          {sentryData?.status && (
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>
              Status: <span style={{ color: "#d1d5db" }}>{sentryData.status}</span>
            </div>
          )}
        </div>
        <div style={{ color: "#e5e7eb", fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}>
          {analysis.error_type || analysis.filename}
        </div>
        {summary && (
          <div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: 1.6 }}>{summary}</div>
        )}
      </div>

      {/* KPIs */}
      <Section title="IMPACT METRICS">
        <div style={{ display: "flex", gap: "10px" }}>
          {eventCount != null && (
            <KpiCard label="Total Events" value={eventCount.toLocaleString()} sub={trendLabel} color="#f59e0b" />
          )}
          {userCount != null && (
            <KpiCard label="Users Affected" value={String(userCount)} sub={`${sev} severity`} color={sevColor} />
          )}
          <KpiCard label="Fix Status" value={fixStatus} color={fixColor} />
        </div>

        {(sentryData?.firstSeen || sentryData?.lastSeen) && (
          <div style={{
            marginTop: "10px", display: "flex", gap: "20px",
            padding: "8px 12px", background: "rgba(255,255,255,0.02)",
            borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: "11px", fontFamily: mono,
          }}>
            {sentryData.firstSeen && (
              <span>
                <span style={{ color: "#6b7280" }}>FIRST SEEN </span>
                <span style={{ color: "#d1d5db" }}>{formatDate(sentryData.firstSeen)}</span>
              </span>
            )}
            {sentryData.lastSeen && (
              <span>
                <span style={{ color: "#6b7280" }}>LAST SEEN </span>
                <span style={{ color: "#fca5a5" }}>{formatDate(sentryData.lastSeen)}</span>
              </span>
            )}
            {sentryData.platform && (
              <span>
                <span style={{ color: "#6b7280" }}>PLATFORM </span>
                <span style={{ color: "#d1d5db" }}>{sentryData.platform}</span>
              </span>
            )}
          </div>
        )}
      </Section>

      {/* Fix Timeline */}
      <Section title="RESOLUTION ROADMAP">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {PRIORITY_TIMELINE.map(({ priority, label, color }) => (
            <div key={priority} style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "10px 14px", borderRadius: "6px",
              background: `${color}06`, border: `1px solid ${color}18`,
            }}>
              <div style={{
                flexShrink: 0, padding: "3px 8px", borderRadius: "4px",
                background: `${color}18`, color, fontSize: "11px", fontWeight: 700, fontFamily: mono,
              }}>
                {priority}
              </div>
              <div style={{ fontSize: "12px", color: "#d1d5db" }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>
          P0 items address immediate risk. P1 improves resilience this sprint. P2 prevents recurrence long-term.
        </div>
      </Section>

      {/* Expanded: Patterns summary */}
      {expanded && sentryData && sentryData.detectedPatterns.length > 0 && (
        <Section title="PATTERN INTELLIGENCE" defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sentryData.detectedPatterns.map((p, i) => (
              <div key={i} style={{
                padding: "10px 14px", borderRadius: "6px",
                background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "#a78bfa", fontSize: "12px", fontWeight: 600 }}>{p.patternType}</span>
                  <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>
                    {Math.round(p.confidence * 100)}% confidence
                  </span>
                </div>
                {p.evidence.length > 0 && (
                  <div style={{ color: "#9ca3af", fontSize: "11px" }}>{p.evidence.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Expanded: detailed InfoCards */}
      {expanded && (
        <Section title="FULL BREAKDOWN" defaultOpen={false}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px" }}>
            <InfoCard label="MODEL" value={analysis.ai_model} accent="#6b7280" />
            <InfoCard
              label="CONFIDENCE"
              value={aiResult?.confidence || analysis.confidence || "—"}
              accent="#6b7280"
            />
            <InfoCard
              label="COST"
              value={`$${analysis.cost.toFixed(4)}`}
              accent="#10b981"
            />
            {analysis.analysis_duration_ms && (
              <InfoCard
                label="DURATION"
                value={`${(analysis.analysis_duration_ms / 1000).toFixed(1)}s`}
                accent="#3b82f6"
              />
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
