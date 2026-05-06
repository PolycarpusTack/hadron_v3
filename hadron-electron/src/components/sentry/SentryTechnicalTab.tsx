import Section from "../ui/Section";
import type { Analysis } from "../../services/api";
import type { SentryFullData } from "./sentryTypes";
import SentryExceptionChain from "./SentryExceptionChain";
import { BreadcrumbTimeline, ConfidenceBreakdown, RemediationList } from "./SentrySharedPanels";

const MONO = "'JetBrains Mono','Fira Code',monospace";

interface Props {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

export default function SentryTechnicalTab({ analysis, sentryData, expanded }: Props) {
  const aiResult  = sentryData?.aiResult;
  const firstEx   = sentryData?.exceptions?.[0];
  const fixes     = Array.isArray(aiResult?.suggested_fixes) ? aiResult!.suggested_fixes : [];
  const reproSteps = aiResult?.reproduction_steps ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* EXCEPTION */}
      <Section title="EXCEPTION">
        <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: "6px", padding: "14px" }}>
          <div style={{ color: "#fca5a5", fontSize: "14px", fontFamily: MONO, fontWeight: 700 }}>
            {firstEx?.exception_type || analysis.error_type || "Unknown Exception"}
          </div>
          {(firstEx?.value || analysis.error_message) && (
            <div style={{ color: "#d1d5db", fontSize: "12px", marginTop: "4px", lineHeight: 1.5 }}>
              {firstEx?.value || analysis.error_message}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
            {aiResult?.pattern_type && (
              <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#f97316", background: "rgba(249,115,22,0.1)", padding: "2px 6px", borderRadius: "3px", border: "1px solid rgba(249,115,22,0.2)" }}>
                {aiResult.pattern_type}
              </span>
            )}
            {firstEx?.module && (
              <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#8b5cf6", background: "rgba(139,92,246,0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                {firstEx.module}
              </span>
            )}
            {sentryData?.detectedPatterns.map((p, i) => (
              <span key={i} style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#a78bfa", background: "rgba(139,92,246,0.08)", padding: "2px 6px", borderRadius: "3px", border: "1px solid rgba(139,92,246,0.2)" }}>
                {p.patternType} {Math.round(p.confidence * 100)}%
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* STACK TRACE */}
      <Section title="STACK TRACE">
        <SentryExceptionChain
          exceptions={sentryData?.exceptions ?? []}
          rawStackTrace={analysis.stack_trace ?? aiResult?.stack_trace}
        />
      </Section>

      {/* ROOT CAUSE */}
      <Section title="ROOT CAUSE">
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "16px" }}>
          <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>
            {aiResult?.root_cause || analysis.root_cause || "Root cause not yet determined."}
          </div>
          {aiResult?.user_impact && (
            <div style={{ marginTop: "12px", background: "rgba(245,158,11,0.06)", borderRadius: "6px", padding: "10px" }}>
              <span style={{ color: "#f59e0b", fontSize: "11px", fontWeight: 700, fontFamily: MONO }}>USER IMPACT: </span>
              <span style={{ color: "#fde68a", fontSize: "12px" }}>{aiResult.user_impact}</span>
            </div>
          )}
        </div>
      </Section>

      {/* REPRODUCTION STEPS */}
      {reproSteps.length > 0 && (
        <Section title="REPRODUCTION STEPS">
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {reproSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: "18px", height: "18px", borderRadius: "50%", background: "rgba(59,130,246,0.15)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, fontFamily: MONO, marginTop: "1px" }}>
                  {i + 1}
                </div>
                <span style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>{step}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* REMEDIATION */}
      <Section title="REMEDIATION">
        <RemediationList fixes={fixes} />
      </Section>

      {/* EXPANDED: Breadcrumb Trail */}
      {expanded && (sentryData?.breadcrumbs ?? []).length > 0 && (
        <Section title="BREADCRUMB TRAIL" defaultOpen={false}>
          <BreadcrumbTimeline
            breadcrumbs={sentryData!.breadcrumbs}
            breadcrumbAnalysis={aiResult?.breadcrumb_analysis}
          />
        </Section>
      )}

      {/* EXPANDED: Analysis Confidence */}
      {expanded && aiResult?.confidence_breakdown && (
        <Section title="ANALYSIS CONFIDENCE" defaultOpen={false}>
          <ConfidenceBreakdown breakdown={aiResult.confidence_breakdown} />
        </Section>
      )}

    </div>
  );
}
