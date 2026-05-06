import type { Analysis } from "../../services/api";
import type { WhatsOnEnhancedAnalysis } from "../../types";
import Section from "../ui/Section";
import CopyBtn from "../ui/CopyBtn";

interface CustomerTabProps {
  analysis: Analysis;
  enhancedData: WhatsOnEnhancedAnalysis;
}

export default function CustomerTab({ analysis, enhancedData }: CustomerTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const { summary, rootCause, userScenario, suggestedFix } = enhancedData;

  const reply = `Dear Customer,

Thank you for reporting this issue.

SUMMARY
The application encountered an error while ${summary.affectedWorkflow?.toLowerCase() ?? "performing the requested operation"}. Our engineers have investigated and identified the root cause.

CAUSE
${rootCause.plainEnglish}

WORKAROUND
Until the fix is deployed, please avoid the workflow that triggered this error. Contact your support team if you need immediate assistance.

RESOLUTION
Our development team has identified a fix (estimated effort: ${suggestedFix.estimatedEffort}). You will be notified once it is available in a product release.

Kind regards,
Support Team`;

  const tableRows: [string, string][] = [
    ["Ticket",     analysis.filename],
    ["Verdict",    summary.title],
    ["Workflow",   summary.affectedWorkflow ?? "N/A"],
    ["Severity",   summary.severity.toUpperCase()],
    ["Data risk",  enhancedData.impactAnalysis.dataAtRisk],
    ["Fix scope",  "Base product"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="CUSTOMER-FACING REPLY" actions={<CopyBtn text={reply} label="Copy reply" />}>
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          padding: "20px",
        }}>
          <pre style={{
            fontFamily: "inherit",
            fontSize: "13px",
            color: "#d1d5db",
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            margin: 0,
          }}>
            {reply}
          </pre>
        </div>
      </Section>

      <Section title="SUMMARY TABLE">
        <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
          {tableRows.map(([k, v], i) => (
            <div key={k} style={{
              display: "flex",
              padding: "9px 14px",
              borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
              <span style={{ color: "#6b7280", fontSize: "12px", width: "120px", flexShrink: 0, fontFamily: mono }}>{k}</span>
              <span style={{ color: "#d1d5db", fontSize: "12px" }}>{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="USER JOURNEY (FOR REFERENCE)" defaultOpen={false}>
        <div>
          {userScenario.steps.map((s, i) => (
            <div key={s.step} style={{ display: "flex", gap: "8px", padding: "5px 0", borderBottom: i < userScenario.steps.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span style={{ color: "#6b7280", fontSize: "12px", fontFamily: mono, width: "20px", flexShrink: 0 }}>{s.step}.</span>
              <span style={{ color: s.isCrashPoint ? "#fca5a5" : "#d1d5db", fontSize: "12px" }}>{s.action}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
