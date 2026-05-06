import Section from "../ui/Section";
import CopyBtn from "../ui/CopyBtn";
import type { Analysis } from "../../services/api";
import type { SentryFullData } from "./sentryTypes";
import { ConfidenceBreakdown, RemediationList } from "./SentrySharedPanels";

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'IBM Plex Sans',-apple-system,sans-serif";

function buildReply(analysis: Analysis, sentryData: SentryFullData | null): string {
  const aiResult = sentryData?.aiResult;
  const issueRef = sentryData?.shortId ?? analysis.filename;
  const plainEnglish = aiResult?.plain_english || aiResult?.user_impact || analysis.error_message || "an unexpected error occurred";
  const sev = analysis.severity?.toLowerCase() ?? "medium";
  const impact = sev === "critical" || sev === "high"
    ? "This issue is treated as high priority and our engineering team is actively investigating."
    : "Our engineering team has been notified and is investigating the root cause.";
  const workaround = aiResult?.workaround
    ? `• ${aiResult.workaround}`
    : `• Refresh the page and retry the operation\n• If the issue persists, wait 2–3 minutes before retrying\n• Contact support and reference: ${issueRef}`;

  return `Hi [Customer Name],

Thank you for reporting this issue. We've identified the cause and wanted to share an update.

What happened:
${plainEnglish}

${impact}

In the meantime, you can try:
${workaround}

We'll notify you when a fix has been deployed. We apologize for the inconvenience.

Best regards,
[Your Name]
[Support Team]`;
}

interface Props {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

export default function SentryActionTab({ analysis, sentryData, expanded }: Props) {
  const aiResult = sentryData?.aiResult;
  const replyText = buildReply(analysis, sentryData);

  const sevColor =
    analysis.severity === "critical" ? "#ef4444" :
    analysis.severity === "high"     ? "#f59e0b" :
    analysis.severity === "low"      ? "#10b981" : "#3b82f6";

  const verdictTextColor =
    analysis.severity === "critical" ? "#fca5a5" :
    analysis.severity === "high"     ? "#fde68a" :
    analysis.severity === "low"      ? "#6ee7b7" : "#93c5fd";

  const fixes = Array.isArray(aiResult?.suggested_fixes) ? aiResult!.suggested_fixes : [];

  const workaroundSteps = aiResult?.workaround
    ? [aiResult.workaround]
    : [
        "Refresh the page and retry the operation",
        "Narrow the scope of the operation if applicable",
        "Wait 2–3 minutes if the issue may be resource-related",
        `If error persists, contact support — reference: ${sentryData?.shortId ?? analysis.filename}`,
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* VERDICT */}
      <Section title="VERDICT">
        <div style={{ background: `${sevColor}08`, border: `1px solid ${sevColor}22`, borderRadius: "6px", padding: "14px" }}>
          <div style={{ color: verdictTextColor, fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
            {analysis.error_type}
          </div>
          <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>
            {aiResult?.plain_english || aiResult?.user_impact || analysis.root_cause || "No description available."}
          </div>
        </div>
      </Section>

      {/* CUSTOMER REPLY */}
      <Section title="CUSTOMER REPLY" actions={<CopyBtn text={replyText} label="Copy reply" />}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px" }}>
          <pre style={{ fontFamily: SANS, fontSize: "13px", color: "#d1d5db", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>
            {replyText}
          </pre>
        </div>
      </Section>

      {/* WORKAROUND */}
      <Section title="WORKAROUND">
        <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.12)", borderRadius: "6px", padding: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {workaroundSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: "18px", height: "18px", borderRadius: "50%", background: "rgba(16,185,129,0.15)", color: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, fontFamily: MONO, marginTop: "1px" }}>
                  {i + 1}
                </div>
                <span style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>{step}</span>
              </div>
            ))}
          </div>
          {sentryData?.shortId && (
            <div style={{ marginTop: "10px", padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.06)", fontSize: "12px" }}>
              <span style={{ color: "#6b7280" }}>Support reference: </span>
              <span style={{ color: "#93c5fd", fontFamily: MONO }}>{sentryData.shortId}</span>
            </div>
          )}
        </div>
      </Section>

      {/* REMEDIATION */}
      <Section title="REMEDIATION">
        <RemediationList fixes={fixes} />
      </Section>

      {/* SENTRY ACTIONS */}
      <Section title="SENTRY ACTIONS">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[
            { label: "Assign Issue",             icon: "→" },
            { label: "Link to JIRA",             icon: "⊞" },
            { label: "Mark Resolved in Release", icon: "✓" },
            { label: "Create Alert Rule",        icon: "⊡" },
            { label: "Ignore Until Fix",         icon: "⊘" },
          ].map(a => (
            <button
              key={a.label}
              disabled
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#6b7280", padding: "6px 12px", borderRadius: "5px", fontSize: "11px", cursor: "not-allowed", fontFamily: MONO, display: "flex", alignItems: "center", gap: "5px" }}
            >
              <span style={{ fontSize: "12px" }}>{a.icon}</span>{a.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "8px", color: "#4b5563", fontSize: "11px" }}>
          Sentry workflow actions require direct Sentry API integration
        </div>
      </Section>

      {/* EXPANDED: Analysis confidence */}
      {expanded && aiResult?.confidence_breakdown && (
        <Section title="ANALYSIS CONFIDENCE" defaultOpen={false}>
          <ConfidenceBreakdown breakdown={aiResult.confidence_breakdown} />
        </Section>
      )}

    </div>
  );
}
