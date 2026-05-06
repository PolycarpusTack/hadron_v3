import type { Analysis } from "../../services/api";
import type { WhatsOnEnhancedAnalysis } from "../../types";
import Section from "../ui/Section";
import InfoCard from "../ui/InfoCard";
import AiMetaStrip from "./AiMetaStrip";
import CitationPanel from "../CitationPanel";
import { FeedbackButtons } from "../FeedbackButtons";
import { StarRating } from "../StarRating";
import { InlineEditor } from "../InlineEditor";

interface SupportTabProps {
  analysis: Analysis;
  enhancedData: WhatsOnEnhancedAnalysis;
  expanded: boolean;
  editableRootCause: string;
  onRootCauseSave: (v: string) => void;
}

function Journey({ scenario }: { scenario: WhatsOnEnhancedAnalysis["userScenario"] }) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  return (
    <div>
      <div style={{ position: "relative", paddingLeft: "24px", marginBottom: "12px" }}>
        <div style={{ position: "absolute", left: "7px", top: "4px", bottom: "4px", width: "1px", background: "rgba(255,255,255,0.08)" }} />
        {scenario.steps.map((s, i) => (
          <div key={s.step} style={{ position: "relative", paddingBottom: i < scenario.steps.length - 1 ? "12px" : 0 }}>
            <div style={{
              position: "absolute", left: "-20px", top: "4px",
              width: "11px", height: "11px", borderRadius: "50%",
              background: s.isCrashPoint ? "#ef4444" : "rgba(255,255,255,0.08)",
              border: `2px solid ${s.isCrashPoint ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.12)"}`,
              zIndex: 1,
            }} />
            <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono, marginRight: "8px" }}>{s.step}.</span>
            <span style={{ color: s.isCrashPoint ? "#fca5a5" : "#d1d5db", fontSize: "13px" }}>{s.action}</span>
            {s.details && (
              <div style={{ marginTop: "2px", marginLeft: "22px", color: "#6b7280", fontSize: "11px" }}>{s.details}</div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "10px", borderLeft: "3px solid #10b981" }}>
          <div style={{ color: "#10b981", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "4px", fontFamily: mono }}>EXPECTED</div>
          <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{scenario.expectedResult}</div>
        </div>
        <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "10px", borderLeft: "3px solid #ef4444" }}>
          <div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "4px", fontFamily: mono }}>ACTUAL</div>
          <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{scenario.actualResult}</div>
        </div>
      </div>
      {scenario.reproductionLikelihood !== "unknown" && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280", fontFamily: mono }}>
          Reproduction likelihood: <span style={{ color: "#d1d5db" }}>{scenario.reproductionLikelihood}</span>
        </div>
      )}
    </div>
  );
}

export default function SupportTab({ analysis, enhancedData, expanded, editableRootCause, onRootCauseSave }: SupportTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const { rootCause, summary, userScenario, suggestedFix } = enhancedData;
  const sevColor = summary.severity === "critical" ? "#ef4444" : summary.severity === "high" ? "#f59e0b" : summary.severity === "medium" ? "#3b82f6" : "#10b981";
  const p0Count = suggestedFix.codeChanges.filter(c => c.priority === "P0").length;
  const fixLabel = p0Count > 0 ? `P0 fix available` : suggestedFix.estimatedEffort;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="QUICK SUMMARY">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
          <InfoCard label="MODULE"     value={rootCause.affectedModule} accent="#8b5cf6" sub={analysis.component ?? undefined} />
          <InfoCard label="SEVERITY"   value={summary.severity.toUpperCase()} accent={sevColor} />
          <InfoCard label="CONFIDENCE" value={summary.confidence.toUpperCase()} accent="#6b7280" sub={summary.category} />
          <InfoCard label="FIX"        value={fixLabel} accent="#10b981" sub={`Risk: ${suggestedFix.riskLevel}`} />
        </div>
        {summary.affectedWorkflow && (
          <div style={{ marginTop: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", fontSize: "12px", color: "#9ca3af" }}>
            <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>WORKFLOW </span>
            {summary.affectedWorkflow}
          </div>
        )}
      </Section>

      <Section title="VERDICT">
        <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "6px", padding: "14px" }}>
          <div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{summary.title}</div>
          <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>{rootCause.plainEnglish}</div>
        </div>
      </Section>

      <Section
        title="ROOT CAUSE"
        actions={<FeedbackButtons analysisId={analysis.id} fieldName="rootCause" currentValue={rootCause.technical} />}
      >
        <InlineEditor
          analysisId={analysis.id}
          fieldName="rootCause"
          value={editableRootCause}
          onSave={onRootCauseSave}
        />
        {rootCause.triggerCondition && (
          <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: "6px" }}>
            <span style={{ color: "#f59e0b", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>TRIGGER </span>
            <span style={{ color: "#d1d5db", fontSize: "12px" }}>{rootCause.triggerCondition}</span>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
          <div style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "3px" }}>AFFECTED METHOD</div>
            <code style={{ color: "#93c5fd", fontSize: "12px", fontFamily: mono }}>{rootCause.affectedMethod}</code>
          </div>
          <div style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "3px" }}>AFFECTED MODULE</div>
            <span style={{ color: "#c4b5fd", fontSize: "12px" }}>{rootCause.affectedModule}</span>
          </div>
        </div>
      </Section>

      <Section title="USER JOURNEY">
        <Journey scenario={userScenario} />
      </Section>

      {expanded && (
        <Section title="SIMILAR CASES">
          <CitationPanel
            query={`${analysis.error_type ?? ""} ${rootCause.affectedMethod} ${analysis.stack_trace?.slice(0, 200) ?? ""}`}
            component={analysis.component}
            severity={analysis.severity?.toLowerCase()}
            onCitationClick={() => {}}
            defaultCollapsed={false}
          />
        </Section>
      )}

      <Section title="ANALYSIS QUALITY">
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
