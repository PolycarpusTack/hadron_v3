import type { Analysis } from "../../services/api";
import type { WhatsOnEnhancedAnalysis } from "../../types";
import Section from "../ui/Section";
import Tag from "../ui/Tag";
import ImpactAnalysisSection from "./ImpactAnalysisSection";

interface ExecutiveTabProps {
  analysis: Analysis;
  enhancedData: WhatsOnEnhancedAnalysis;
  expanded: boolean;
}

export default function ExecutiveTab({ analysis, enhancedData, expanded }: ExecutiveTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const { summary, rootCause, suggestedFix, impactAnalysis } = enhancedData;
  const sev = summary.severity;
  const sevColor = sev === "critical" ? "#ef4444" : sev === "high" ? "#f59e0b" : sev === "medium" ? "#3b82f6" : "#10b981";

  const dataRiskColor = impactAnalysis.dataAtRisk === "none" || impactAnalysis.dataAtRisk === "low"
    ? "#10b981"
    : impactAnalysis.dataAtRisk === "moderate" ? "#f59e0b" : "#ef4444";

  const kpis = [
    {
      label: "DIRECTLY AFFECTED",
      value: impactAnalysis.directlyAffected.length > 0
        ? impactAnalysis.directlyAffected.map(f => f.feature).join(", ")
        : "Under investigation",
      sub: `${impactAnalysis.directlyAffected.length} direct · ${impactAnalysis.potentiallyAffected.length} at risk`,
      color: impactAnalysis.directlyAffected.length > 0 ? "#f59e0b" : "#6b7280",
    },
    {
      label: "DATA AT RISK",
      value: impactAnalysis.dataAtRisk.charAt(0).toUpperCase() + impactAnalysis.dataAtRisk.slice(1),
      sub: impactAnalysis.dataRiskDescription ?? "No data loss expected",
      color: dataRiskColor,
    },
    {
      label: "FIX EFFORT",
      value: suggestedFix.estimatedEffort.charAt(0).toUpperCase() + suggestedFix.estimatedEffort.slice(1),
      sub: `${suggestedFix.complexity} · risk: ${suggestedFix.riskLevel}`,
      color: "#10b981",
    },
  ];

  const path = [
    { phase: "NOW",       label: "Workaround",   desc: "Identify and avoid affected workflows",                    color: "#10b981" },
    { phase: "THIS WEEK", label: "P0 Fix",        desc: `${suggestedFix.codeChanges.filter(c => c.priority === "P0").length} change(s) · ${suggestedFix.estimatedEffort}`, color: "#f59e0b" },
    { phase: "SPRINT",    label: "Hardening",     desc: "P1/P2 remediation + regression coverage",                 color: "#3b82f6" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Impact headline */}
      <div style={{ background: `${sevColor}08`, border: `1px solid ${sevColor}22`, borderRadius: "10px", padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#e5e7eb", fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>{summary.title}</div>
            <div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: 1.6 }}>{rootCause.plainEnglish}</div>
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "5px",
            background: `${sevColor}18`, color: sevColor,
            padding: "4px 12px", borderRadius: "4px",
            fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: "6px" }}>⬤</span>
            {sev.toUpperCase()}
          </span>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
        {kpis.map(kpi => (
          <div key={kpi.label} style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "8px",
            padding: "14px",
            textAlign: "center",
          }}>
            <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono, marginBottom: "6px" }}>{kpi.label}</div>
            <div style={{ color: kpi.color, fontSize: "13px", fontWeight: 600 }}>{kpi.value}</div>
            <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "3px" }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Resolution path */}
      <Section title="RESOLUTION PATH">
        <div style={{ display: "flex", gap: "10px" }}>
          {path.map(it => (
            <div key={it.phase} style={{
              flex: 1,
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${it.color}33`,
              borderTop: `3px solid ${it.color}`,
              borderRadius: "0 0 6px 6px",
              padding: "12px",
            }}>
              <div style={{ color: it.color, fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{it.phase}</div>
              <div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "5px" }}>{it.label}</div>
              <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "3px" }}>{it.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      {expanded && (
        <Section title="IMPACT DETAIL" defaultOpen={false}>
          <ImpactAnalysisSection impact={impactAnalysis} />
        </Section>
      )}

      {/* Footer meta */}
      <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{analysis.filename}</div>
            <div style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono, marginTop: "2px" }}>
              {analysis.ai_model} · {analysis.tokens_used.toLocaleString()} tokens · ${analysis.cost.toFixed(4)}
            </div>
          </div>
          <Tag text={summary.category} color="#6b7280" />
        </div>
      </div>
    </div>
  );
}
