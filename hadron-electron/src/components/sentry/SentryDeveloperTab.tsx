import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Analysis } from "../../services/api";
import Section from "../ui/Section";
import InfoCard from "../ui/InfoCard";
import CopyBtn from "../ui/CopyBtn";
import AiMetaStrip from "../whatson/AiMetaStrip";
import SentryExceptionChain from "./SentryExceptionChain";
import SentryPatternCard from "./SentryPatternCard";
import SentryRuntimeContext from "./SentryRuntimeContext";
import SentryBreadcrumbTimeline from "./SentryBreadcrumbTimeline";
import type { SentryFullData } from "./sentryTypes";
import { groupFixesByPriority } from "./sentryTypes";

interface SentryDeveloperTabProps {
  analysis: Analysis;
  sentryData: SentryFullData | null;
  expanded: boolean;
}

const PRIORITY_META: Record<"P0" | "P1" | "P2", { label: string; color: string; bg: string }> = {
  P0: { label: "P0 — Immediate",    color: "#ef4444", bg: "rgba(239,68,68,0.06)"  },
  P1: { label: "P1 — This Sprint",  color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
  P2: { label: "P2 — Planned",      color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
};

function FixGroup({ priority, fixes }: { priority: "P0" | "P1" | "P2"; fixes: string[] }) {
  const [open, setOpen] = useState(priority === "P0");
  const meta = PRIORITY_META[priority];
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";

  return (
    <div style={{ border: `1px solid ${meta.color}22`, borderRadius: "8px", overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px", background: meta.bg, border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: meta.color, fontSize: "11px", fontWeight: 700, fontFamily: mono }}>
          {meta.label}
        </span>
        <span style={{ marginLeft: "auto", color: "#6b7280", fontSize: "11px" }}>
          {fixes.length} {fixes.length === 1 ? "fix" : "fixes"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {fixes.map((fix, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <div style={{
                flexShrink: 0, width: "20px", height: "20px", borderRadius: "50%",
                background: `${meta.color}22`, color: meta.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "10px", fontWeight: 700, fontFamily: mono,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, fontSize: "13px", color: "#d1d5db", lineHeight: 1.6 }}>
                <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-p:text-gray-300 prose-strong:text-gray-200 prose-code:bg-gray-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-ul:my-1 prose-li:my-0.5 prose-li:text-gray-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fix}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SentryDeveloperTab({
  analysis,
  sentryData,
  expanded,
}: SentryDeveloperTabProps) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const aiResult = sentryData?.aiResult;
  const sevColor =
    analysis.severity === "critical" ? "#ef4444" :
    analysis.severity === "high"     ? "#f59e0b" :
    analysis.severity === "medium"   ? "#3b82f6" : "#10b981";

  // Parse suggested fixes
  let fixesArray: string[] | null = null;
  if (aiResult?.suggested_fixes && Array.isArray(aiResult.suggested_fixes)) {
    fixesArray = aiResult.suggested_fixes;
  } else {
    const raw = analysis.suggested_fixes;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) fixesArray = parsed as string[];
      } catch {
        // will render as markdown
      }
    }
  }

  const groupedFixes = fixesArray ? groupFixesByPriority(fixesArray) : null;
  const suggestedFixesRaw = analysis.suggested_fixes;

  const topFrames = sentryData?.exceptions
    .flatMap(ex => ex.stacktrace?.frames ?? [])
    .filter(f => f.inApp)
    .slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Classification */}
      <Section title="CLASSIFICATION">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <InfoCard
            label="EXCEPTION"
            value={aiResult?.error_type || analysis.error_type || "—"}
            accent="#ef4444"
          />
          <InfoCard
            label="COMPONENT"
            value={aiResult?.component || sentryData?.culprit || analysis.component || "—"}
            accent="#3b82f6"
          />
          <InfoCard
            label="SEVERITY"
            value={analysis.severity.toUpperCase()}
            accent={sevColor}
            sub={aiResult?.confidence || analysis.confidence || undefined}
          />
        </div>

        {/* Pattern type + fingerprint signature */}
        {(aiResult?.pattern_type || sentryData?.detectedPatterns.length) && (
          <div style={{
            marginTop: "10px", padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: "8px",
            background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {aiResult?.pattern_type && (
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                <span style={{ fontFamily: mono, color: "#6b7280" }}>PATTERN </span>
                <span style={{ color: "#d1d5db" }}>{aiResult.pattern_type}</span>
              </span>
            )}
            {sentryData?.detectedPatterns.map((p, i) => (
              <span key={i} style={{
                padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 600,
                background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)",
                fontFamily: mono,
              }}>
                {p.patternType} {Math.round(p.confidence * 100)}%
              </span>
            ))}
          </div>
        )}

        {/* Top in-app frames */}
        {topFrames && topFrames.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "4px" }}>TOP IN-APP FRAMES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {topFrames.map((f, i) => (
                <div key={i} style={{ fontSize: "11px", fontFamily: mono, color: i === 0 ? "#93c5fd" : "#6b7280" }}>
                  {f.function || f.filename}
                  {f.lineNo != null && <span style={{ color: "#4b5563" }}>:{f.lineNo}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Technical Root Cause */}
      <Section title="ROOT CAUSE (TECHNICAL)">
        <div style={{
          background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)",
          borderLeft: "3px solid #3b82f6", borderRadius: "6px", padding: "14px",
        }}>
          <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>
            {aiResult?.root_cause || analysis.root_cause}
          </div>
        </div>
      </Section>

      {/* Exception Chain / Stack Trace */}
      <Section title="EXCEPTION CHAIN">
        <SentryExceptionChain
          exceptions={sentryData?.exceptions ?? []}
          rawStackTrace={analysis.stack_trace}
        />
      </Section>

      {/* Suggested Fixes */}
      <Section title="REMEDIATION">
        {groupedFixes ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(["P0", "P1", "P2"] as const).map(priority =>
              groupedFixes[priority].length > 0 ? (
                <FixGroup key={priority} priority={priority} fixes={groupedFixes[priority]} />
              ) : null
            )}
          </div>
        ) : suggestedFixesRaw ? (
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 0, right: 0 }}>
              <CopyBtn text={String(suggestedFixesRaw)} />
            </div>
            <div className="prose prose-sm prose-invert max-w-none prose-headings:text-gray-200 prose-h2:text-base prose-h2:font-semibold prose-h3:text-sm prose-p:my-2 prose-p:text-gray-300 prose-strong:text-gray-200 prose-code:bg-gray-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-ul:my-2 prose-li:my-0.5 prose-li:text-gray-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {String(suggestedFixesRaw)}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <div style={{ color: "#6b7280", fontSize: "13px" }}>No remediation data available.</div>
        )}
      </Section>

      {/* Expanded: Detected Patterns detail */}
      {expanded && sentryData && sentryData.detectedPatterns.length > 0 && (
        <Section title="DETECTED PATTERNS" defaultOpen={false}>
          <SentryPatternCard
            patterns={sentryData.detectedPatterns}
            aiPatternType={aiResult?.pattern_type}
            aiSeverity={aiResult?.severity}
            aiComponent={aiResult?.component}
            errorType={aiResult?.error_type}
          />
        </Section>
      )}

      {/* Expanded: Runtime Context */}
      {expanded && (sentryData?.contexts || (sentryData?.tags && sentryData.tags.length > 0)) && (
        <Section title="RUNTIME CONTEXT" defaultOpen={false}>
          <SentryRuntimeContext
            contexts={sentryData?.contexts}
            tags={sentryData?.tags}
          />
        </Section>
      )}

      {/* Expanded: Full Breadcrumb Timeline */}
      {expanded && sentryData && sentryData.breadcrumbs.length > 0 && (
        <Section title="FULL BREADCRUMB TRAIL" defaultOpen={false}>
          <SentryBreadcrumbTimeline
            breadcrumbs={sentryData.breadcrumbs}
            breadcrumbAnalysis={aiResult?.breadcrumb_analysis}
          />
        </Section>
      )}

      <AiMetaStrip analysis={analysis} />
    </div>
  );
}
