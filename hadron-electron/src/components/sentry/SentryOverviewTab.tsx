import { format } from "date-fns";
import Section from "../ui/Section";
import type { Analysis } from "../../services/api";
import type { SentryFullData } from "./sentryTypes";
import {
  EventTimeline,
  BreadcrumbTimeline,
  TagsPanel,
  ContextPanels,
  FingerprintChips,
  ConfidenceBreakdown,
} from "./SentrySharedPanels";

const MONO = "'JetBrains Mono','Fira Code',monospace";

function KpiCard({ label, value, accent, sub }: { label: string; value: string | number; accent: string; sub?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderTop: `2px solid ${accent}`, borderRadius: "0 0 6px 6px", padding: "12px" }}>
      <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: MONO }}>{label}</div>
      <div style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 600, marginTop: "4px", fontFamily: MONO }}>{value}</div>
      {sub && <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "3px" }}>{sub}</div>}
    </div>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try { return format(new Date(iso), "MMM d"); }
  catch { return "—"; }
}

function computeTrend(stats: Array<[number, number]>): string {
  if (stats.length < 4) return "";
  const half = Math.floor(stats.length / 2);
  const recent = stats.slice(-half).reduce((s, [, c]) => s + c, 0);
  const older  = stats.slice(0, half).reduce((s, [, c]) => s + c, 0);
  if (older === 0 && recent > 0) return "↑ new";
  if (older === 0) return "";
  const ratio = recent / older;
  if (ratio >= 2)   return `↑ ${Math.round(ratio)}×`;
  if (ratio > 1.1)  return "↑ rising";
  if (ratio < 0.5)  return "↓ falling";
  return "→ stable";
}

interface Props {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

export default function SentryOverviewTab({ analysis, sentryData, expanded }: Props) {
  const aiResult   = sentryData?.aiResult;
  const stats      = sentryData?.eventStats ?? [];
  const eventCount = sentryData?.count ? parseInt(sentryData.count, 10) : null;
  const trend      = computeTrend(stats);
  const trendAccent = trend.startsWith("↑") ? "#ef4444" : trend.startsWith("↓") ? "#10b981" : "#6b7280";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* KPI Cards */}
      <Section title="ISSUE METRICS">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
          {eventCount != null && (
            <KpiCard label="EVENTS" value={eventCount.toLocaleString()} accent="#f97316" sub={sentryData?.status?.toUpperCase()} />
          )}
          {sentryData?.userCount != null && sentryData.userCount > 0 && (
            <KpiCard label="USERS AFFECTED" value={sentryData.userCount} accent="#8b5cf6" />
          )}
          <KpiCard label="FIRST SEEN" value={fmtDate(sentryData?.firstSeen)} accent="#6b7280" sub={sentryData?.firstSeen?.split("T")[0]} />
          <KpiCard label="LAST SEEN"  value={fmtDate(sentryData?.lastSeen)}  accent="#f59e0b" sub={sentryData?.lastSeen?.split("T")[0]} />
          {trend && (
            <KpiCard label="TREND" value={trend} accent={trendAccent} />
          )}
        </div>
      </Section>

      {/* Event Timeline */}
      {stats.length > 0 && (
        <Section title="EVENT TIMELINE">
          <EventTimeline eventStats={stats} />
        </Section>
      )}

      {/* Breadcrumb Trail */}
      {(sentryData?.breadcrumbs ?? []).length > 0 && (
        <Section title="BREADCRUMB TRAIL">
          <BreadcrumbTimeline
            breadcrumbs={sentryData!.breadcrumbs}
            breadcrumbAnalysis={aiResult?.breadcrumb_analysis}
          />
        </Section>
      )}

      {/* System Context */}
      {sentryData?.contexts && Object.keys(sentryData.contexts).length > 0 && (
        <Section title="SYSTEM CONTEXT AT FAILURE">
          <ContextPanels contexts={sentryData.contexts} />
        </Section>
      )}

      {/* Expanded extras */}
      {expanded && (sentryData?.tags ?? []).length > 0 && (
        <Section title="TAGS" defaultOpen={false}>
          <TagsPanel tags={sentryData!.tags} />
        </Section>
      )}

      {expanded && (aiResult?.fingerprint ?? []).length > 0 && (
        <Section title="FINGERPRINT" defaultOpen={false}>
          <FingerprintChips fingerprint={aiResult!.fingerprint} />
        </Section>
      )}

      {expanded && sentryData?.culprit && (
        <Section title="CULPRIT / RELEASE INFO" defaultOpen={false}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", padding: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {sentryData.culprit && (
                <div>
                  <div style={{ color: "#6b7280", fontSize: "9px", fontFamily: MONO }}>CULPRIT</div>
                  <div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: MONO, marginTop: "2px" }}>{sentryData.culprit}</div>
                </div>
              )}
              {sentryData.platform && (
                <div>
                  <div style={{ color: "#6b7280", fontSize: "9px", fontFamily: MONO }}>PLATFORM</div>
                  <div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: MONO, marginTop: "2px" }}>{sentryData.platform}</div>
                </div>
              )}
              {analysis.analyzed_at && (
                <div>
                  <div style={{ color: "#6b7280", fontSize: "9px", fontFamily: MONO }}>ANALYZED</div>
                  <div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: MONO, marginTop: "2px" }}>
                    {format(new Date(analysis.analyzed_at), "MMM d, yyyy HH:mm")}
                  </div>
                </div>
              )}
              <div>
                <div style={{ color: "#6b7280", fontSize: "9px", fontFamily: MONO }}>MODEL</div>
                <div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: MONO, marginTop: "2px" }}>{analysis.ai_model}</div>
              </div>
            </div>
          </div>
        </Section>
      )}

      {expanded && aiResult?.confidence_breakdown && (
        <Section title="ANALYSIS CONFIDENCE" defaultOpen={false}>
          <ConfidenceBreakdown breakdown={aiResult.confidence_breakdown} />
        </Section>
      )}

    </div>
  );
}
