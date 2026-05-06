import type { Analysis } from "../../services/api";
import type { WhatsOnEnhancedAnalysis } from "../../types";
import Section from "../ui/Section";
import InfoCard from "../ui/InfoCard";
import AiMetaStrip from "./AiMetaStrip";
import StackTraceSection from "./StackTraceSection";
import RemediationSection from "./RemediationSection";
import ImpactAnalysisSection from "./ImpactAnalysisSection";
import TestScenariosSection from "./TestScenariosSection";
import ContextTab from "./ContextTab";
import DatabaseTab from "./DatabaseTab";
import MemoryTab from "./MemoryTab";
import EnvironmentTab from "./EnvironmentTab";

interface DeveloperTabProps {
  analysis: Analysis;
  enhancedData: WhatsOnEnhancedAnalysis;
  expanded: boolean;
}

export default function DeveloperTab({ analysis, enhancedData, expanded }: DeveloperTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const { rootCause, summary, suggestedFix, stackTrace, impactAnalysis, testScenarios, context, databaseAnalysis, memoryAnalysis, environment } = enhancedData;
  const sevColor = summary.severity === "critical" ? "#ef4444" : summary.severity === "high" ? "#f59e0b" : summary.severity === "medium" ? "#3b82f6" : "#10b981";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="CLASSIFICATION">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <InfoCard label="EXCEPTION" value={analysis.error_type}          accent="#ef4444" />
          <InfoCard label="MODULE"    value={rootCause.affectedModule}      accent="#3b82f6" sub={analysis.component ?? undefined} />
          <InfoCard label="SEVERITY"  value={summary.severity.toUpperCase()} accent={sevColor} sub={`Confidence: ${summary.confidence}`} />
        </div>
        <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>
            <strong style={{ color: "#e5e7eb" }}>Affected method: </strong>
            <code style={{ color: "#93c5fd", fontFamily: mono }}>{rootCause.affectedMethod}</code>
          </div>
          {rootCause.triggerCondition && (
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>
              <strong style={{ color: "#e5e7eb" }}>Trigger: </strong>{rootCause.triggerCondition}
            </div>
          )}
        </div>
      </Section>

      <Section title="ROOT CAUSE (TECHNICAL)">
        <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)", borderLeft: "3px solid #3b82f6", borderRadius: "6px", padding: "14px" }}>
          <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>{rootCause.technical}</div>
        </div>
      </Section>

      <Section title="STACK TRACE">
        <StackTraceSection stackTrace={stackTrace} rawStackTrace={analysis.stack_trace} expanded={expanded} />
      </Section>

      <Section title="REMEDIATION">
        <RemediationSection fix={suggestedFix} />
      </Section>

      {expanded && (
        <Section title="IMPACT & BLAST RADIUS" defaultOpen={false}>
          <ImpactAnalysisSection impact={impactAnalysis} />
        </Section>
      )}

      {expanded && testScenarios && testScenarios.length > 0 && (
        <Section title="TEST SCENARIOS" defaultOpen={false}>
          <TestScenariosSection scenarios={testScenarios} />
        </Section>
      )}

      {expanded && context && (
        <Section title="CONTEXT" defaultOpen={false}>
          <ContextTab context={context} />
        </Section>
      )}

      {expanded && databaseAnalysis && (
        <Section title="DATABASE" defaultOpen={false}>
          <DatabaseTab database={databaseAnalysis} />
        </Section>
      )}

      {expanded && memoryAnalysis && (
        <Section title="MEMORY" defaultOpen={false}>
          <MemoryTab memory={memoryAnalysis} />
        </Section>
      )}

      {expanded && environment && (
        <Section title="ENVIRONMENT" defaultOpen={false}>
          <EnvironmentTab environment={environment} analysis={analysis} />
        </Section>
      )}

      <AiMetaStrip analysis={analysis} />
    </div>
  );
}
