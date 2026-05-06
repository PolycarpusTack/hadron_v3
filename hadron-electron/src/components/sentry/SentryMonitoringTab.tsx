import Section from "../ui/Section";
import CopyBtn from "../ui/CopyBtn";
import type { Analysis } from "../../services/api";
import type { SentryFullData } from "./sentryTypes";
import {
  EventTimeline,
  TagsPanel,
  ContextPanels,
  FingerprintChips,
  AlertRulesPanel,
} from "./SentrySharedPanels";

const MONO = "'JetBrains Mono','Fira Code',monospace";

interface Props {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

export default function SentryMonitoringTab({ analysis, sentryData, expanded }: Props) {
  const aiResult    = sentryData?.aiResult;
  const alerts      = aiResult?.monitoring_alerts ?? [];
  const fingerprint = aiResult?.fingerprint ?? [];
  const stats       = sentryData?.eventStats ?? [];

  const fingerprintRule = fingerprint.length > 0
    ? `fingerprint = [${fingerprint.map(f => `"${f.toLowerCase().replace(/\s+/g, "-")}"`).join(", ")}]`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ALERT RULES */}
      <Section title="RECOMMENDED ALERT RULES">
        <AlertRulesPanel alerts={alerts} />
      </Section>

      {/* EVENT TIMELINE */}
      {stats.length > 0 && (
        <Section title="EVENT TIMELINE">
          <EventTimeline eventStats={stats} />
        </Section>
      )}

      {/* TAGS */}
      {(sentryData?.tags ?? []).length > 0 && (
        <Section title="TAGS">
          <TagsPanel tags={sentryData!.tags} />
        </Section>
      )}

      {/* SYSTEM CONTEXT */}
      {sentryData?.contexts && Object.keys(sentryData.contexts).length > 0 && (
        <Section title="SYSTEM CONTEXT AT FAILURE">
          <ContextPanels contexts={sentryData.contexts} />
        </Section>
      )}

      {/* FINGERPRINT RULE */}
      {fingerprint.length > 0 && (
        <Section title="FINGERPRINT RULE" actions={fingerprintRule ? <CopyBtn text={fingerprintRule} /> : undefined}>
          <FingerprintChips fingerprint={fingerprint} />
          {fingerprintRule && (
            <div style={{ marginTop: "8px", background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "10px" }}>
              <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: MONO, marginBottom: "4px" }}>SENTRY FINGERPRINT RULE</div>
              <pre style={{ fontFamily: MONO, fontSize: "11px", color: "#fb923c", margin: 0 }}>{fingerprintRule}</pre>
            </div>
          )}
        </Section>
      )}

      {/* EXPANDED: Dashboard query suggestions */}
      {expanded && (
        <Section title="SUGGESTED DASHBOARD QUERIES" defaultOpen={false}>
          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
            {[
              [`${analysis.error_type} Events / Hour`, "Time Series", `exception.type:${analysis.error_type}`],
              ["Top Affected Users", "Table", "group by user.username"],
              ["Error Rate by Environment", "Bar Chart", "group by environment"],
              ["Issue Recurrence Trend", "Time Series", "is:unresolved"],
              ["Error Spike Detection", "Time Series", "count() > 10 / 30m"],
            ].map(([name, type, query], i, arr) => (
              <div key={String(name)} style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", padding: "8px 12px", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", alignItems: "center" }}>
                <span style={{ color: "#d1d5db", fontSize: "12px" }}>{name}</span>
                <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#6b7280", background: "rgba(107,114,128,0.15)", padding: "2px 6px", borderRadius: "3px", justifySelf: "center" }}>
                  {type}
                </span>
                <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: MONO }}>{query}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

    </div>
  );
}
