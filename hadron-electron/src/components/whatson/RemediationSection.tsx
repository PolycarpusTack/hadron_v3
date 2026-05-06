import { useState } from "react";
import type { WhatsOnSuggestedFix } from "../../types";
import CopyBtn from "../ui/CopyBtn";
import Tag from "../ui/Tag";

interface RemediationSectionProps {
  fix: WhatsOnSuggestedFix;
}

const PRIORITY = {
  P0: { color: "#ef4444", label: "P0 — FIX TODAY" },
  P1: { color: "#f59e0b", label: "P1 — THIS SPRINT" },
  P2: { color: "#6b7280", label: "P2 — NEXT RELEASE" },
} as const;

export default function RemediationSection({ fix }: RemediationSectionProps) {
  const [open, setOpen] = useState<Set<string>>(new Set(["P0-0"]));
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";

  const toggle = (key: string) => {
    const n = new Set(open);
    n.has(key) ? n.delete(key) : n.add(key);
    setOpen(n);
  };

  const riskColor = fix.riskLevel === "low" ? "#10b981" : fix.riskLevel === "medium" ? "#f59e0b" : "#ef4444";

  return (
    <div>
      {/* Summary bar */}
      <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "6px", padding: "12px", marginBottom: "16px" }}>
        <div style={{ color: "#6ee7b7", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>{fix.summary}</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Tag text={fix.complexity} color="#10b981" />
          <Tag text={`⏱ ${fix.estimatedEffort}`} color="#9ca3af" />
          <Tag text={`Risk: ${fix.riskLevel}`} color={riskColor} />
        </div>
        {fix.reasoning && (
          <div style={{ marginTop: "8px", color: "#9ca3af", fontSize: "12px", lineHeight: 1.5 }}>{fix.reasoning}</div>
        )}
      </div>

      {/* P0 / P1 / P2 groups */}
      {(["P0", "P1", "P2"] as const).map(p => {
        const items = fix.codeChanges.filter(c => c.priority === p);
        if (!items.length) return null;
        const meta = PRIORITY[p];
        return (
          <div key={p} style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: meta.color, marginBottom: "8px", fontFamily: mono }}>
              {meta.label}
            </div>
            {items.map((item, i) => {
              const key = `${p}-${i}`;
              const isOpen = open.has(key);
              const codeSnippet = [item.before && `Before:\n${item.before}`, item.after && `After:\n${item.after}`].filter(Boolean).join("\n\n");
              return (
                <div key={key} style={{
                  background: `${meta.color}0a`,
                  border: `1px solid ${meta.color}22`,
                  borderRadius: "6px",
                  padding: "12px",
                  marginBottom: "6px",
                }}>
                  <button
                    onClick={() => toggle(key)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}
                  >
                    <span style={{ color: "#4b5563", fontSize: "10px", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", display: "inline-block" }}>▶</span>
                    <span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, textAlign: "left", flex: 1, fontFamily: mono }}>{item.file}</span>
                    {codeSnippet && <CopyBtn text={codeSnippet} />}
                  </button>

                  {isOpen && (
                    <>
                      <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5, marginBottom: (item.before || item.after) ? "10px" : 0 }}>
                        {item.description}
                      </div>
                      {(item.before || item.after) && (
                        <div style={{ display: "grid", gridTemplateColumns: item.before && item.after ? "1fr 1fr" : "1fr", gap: "8px" }}>
                          {item.before && (
                            <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "4px", padding: "10px" }}>
                              <div style={{ fontSize: "10px", color: "#ef4444", fontFamily: mono, marginBottom: "4px" }}>BEFORE</div>
                              <pre style={{ fontSize: "11px", color: "#fca5a5", fontFamily: mono, margin: 0, whiteSpace: "pre-wrap" }}>{item.before}</pre>
                            </div>
                          )}
                          {item.after && (
                            <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "4px", padding: "10px" }}>
                              <div style={{ fontSize: "10px", color: "#10b981", fontFamily: mono, marginBottom: "4px" }}>AFTER</div>
                              <pre style={{ fontSize: "11px", color: "#6ee7b7", fontFamily: mono, margin: 0, whiteSpace: "pre-wrap" }}>{item.after}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {fix.explanation && (
        <div style={{ padding: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
          <div style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "6px" }}>ADDITIONAL NOTES</div>
          <div style={{ color: "#9ca3af", fontSize: "12px", lineHeight: 1.6 }}>{fix.explanation}</div>
        </div>
      )}
    </div>
  );
}
