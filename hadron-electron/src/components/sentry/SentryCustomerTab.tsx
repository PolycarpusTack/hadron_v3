import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Analysis } from "../../services/api";
import Section from "../ui/Section";
import CopyBtn from "../ui/CopyBtn";
import type { SentryFullData } from "./sentryTypes";

interface SentryCustomerTabProps {
  analysis: Analysis;
  sentryData: SentryFullData | null;
}

function buildResponseTemplate(analysis: Analysis, sentryData: SentryFullData | null): string {
  const aiResult = sentryData?.aiResult;
  const issueLabel = sentryData?.shortId ?? "this issue";
  const plainEnglish =
    aiResult?.plain_english ||
    aiResult?.error_message ||
    aiResult?.user_impact ||
    analysis.error_message ||
    "an unexpected error occurred";
  const sev = analysis.severity?.toLowerCase() ?? "medium";
  const impact =
    sev === "critical" || sev === "high"
      ? "This issue is treated as high priority and our engineering team is actively investigating."
      : "Our engineering team has been notified and is investigating the root cause.";
  const workaround = aiResult?.workaround
    ? `• ${aiResult.workaround}`
    : `• Refresh the page and try the operation again\n• If the issue persists, please wait a few minutes before retrying\n• Contact support if the problem continues — reference: ${issueLabel}`;

  return `Hi [Customer Name],

Thank you for reporting this issue. We've identified the cause and wanted to share an update with you.

What happened:
${plainEnglish}

${impact}

In the meantime, you can try the following:
${workaround}

We'll notify you when a fix has been deployed. We apologize for the inconvenience.

Best regards,
[Your Name]
[Support Team]`;
}

function InlineStatusBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "12px 16px", background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", flex: 1,
      minWidth: "100px",
    }}>
      <div style={{ color, fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "4px", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
    </div>
  );
}

export default function SentryCustomerTab({ analysis, sentryData }: SentryCustomerTabProps) {
  const [copied, setCopied] = useState(false);
  const aiResult = sentryData?.aiResult;

  const sev = analysis.severity?.toLowerCase() ?? "unknown";
  const sevColor =
    sev === "critical" ? "#ef4444" :
    sev === "high"     ? "#f59e0b" :
    sev === "medium"   ? "#3b82f6" : "#10b981";

  const plainEnglish =
    aiResult?.plain_english ||
    aiResult?.error_message ||
    aiResult?.user_impact ||
    analysis.error_message ||
    null;

  const userImpact = aiResult?.user_impact || null;
  const workaround = aiResult?.workaround || null;
  const eventCount = sentryData?.count ? parseInt(sentryData.count, 10) : null;
  const userCount  = sentryData?.userCount ?? null;

  const responseTemplate = buildResponseTemplate(analysis, sentryData);

  const handleCopyTemplate = () => {
    navigator.clipboard.writeText(responseTemplate);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* At-a-glance stats */}
      <Section title="IMPACT AT A GLANCE">
        <div style={{ display: "flex", gap: "10px" }}>
          <InlineStatusBadge
            label="Severity"
            value={sev.charAt(0).toUpperCase() + sev.slice(1)}
            color={sevColor}
          />
          {eventCount != null && (
            <InlineStatusBadge label="Reports" value={eventCount.toLocaleString()} color="#f59e0b" />
          )}
          {userCount != null && (
            <InlineStatusBadge label="Users Affected" value={String(userCount)} color="#ef4444" />
          )}
        </div>
      </Section>

      {/* Plain English Explanation */}
      <Section title="WHAT HAPPENED (PLAIN ENGLISH)">
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderLeft: "3px solid #6b7280", borderRadius: "6px", padding: "14px",
        }}>
          <div style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
            {analysis.error_type || "Unexpected Error"}
          </div>
          {plainEnglish ? (
            <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>{plainEnglish}</div>
          ) : (
            <div style={{ color: "#6b7280", fontSize: "13px" }}>
              An error occurred that interrupted the user's workflow. The technical team has details on the root cause.
            </div>
          )}
        </div>
      </Section>

      {/* User Impact */}
      {userImpact && userImpact !== plainEnglish && (
        <Section title="USER EXPERIENCE">
          <div style={{
            padding: "12px 14px", background: "rgba(245,158,11,0.04)", borderRadius: "6px",
            border: "1px solid rgba(245,158,11,0.12)", color: "#d1d5db", fontSize: "13px", lineHeight: 1.7,
          }}>
            {userImpact}
          </div>
        </Section>
      )}

      {/* Workarounds */}
      <Section title="WORKAROUND ADVICE">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {(workaround
            ? [workaround]
            : [
                "Refresh the page and retry the operation",
                "Wait 2–3 minutes before retrying (resource pressure may resolve)",
                "Narrow the scope of the operation (fewer items, tighter date range, etc.)",
                "If error persists, contact support with the error reference",
              ]
          ).map((step, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "13px" }}>
              <div style={{
                flexShrink: 0, width: "18px", height: "18px", borderRadius: "50%",
                background: "rgba(16,185,129,0.12)", color: "#10b981",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "10px", fontWeight: 700, marginTop: "1px",
              }}>
                {i + 1}
              </div>
              <span style={{ color: "#d1d5db" }}>{step}</span>
            </div>
          ))}
        </div>
        {sentryData?.shortId && (
          <div style={{
            marginTop: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.02)",
            borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", fontSize: "12px",
          }}>
            <span style={{ color: "#6b7280" }}>Support reference: </span>
            <span style={{ color: "#93c5fd", fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)" }}>
              {sentryData.shortId}
            </span>
          </div>
        )}
      </Section>

      {/* Copy-ready Response Template */}
      <Section title="RESPONSE TEMPLATE">
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: "8px", right: "8px", zIndex: 1 }}>
            <button
              onClick={handleCopyTemplate}
              style={{
                display: "flex", alignItems: "center", gap: "4px",
                padding: "4px 10px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)", color: copied ? "#10b981" : "#9ca3af",
                fontSize: "11px", cursor: "pointer", transition: "color .15s",
              }}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{
            padding: "14px 40px 14px 14px",
            background: "rgba(255,255,255,0.02)", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.06)",
            fontSize: "12px", lineHeight: 1.7, color: "#d1d5db",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontFamily: "var(--hd-font-sans,'IBM Plex Sans',system-ui,sans-serif)",
          }}>
            {responseTemplate}
          </pre>
        </div>
      </Section>
    </div>
  );
}
