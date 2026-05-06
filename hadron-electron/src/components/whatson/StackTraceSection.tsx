import { useState } from "react";
import type { StackTraceAnalysis } from "../../types";
import CopyBtn from "../ui/CopyBtn";

interface StackTraceSectionProps {
  stackTrace?: StackTraceAnalysis;
  rawStackTrace?: string;
  expanded?: boolean;
}

const FRAME_STYLE = {
  error:       { bg: "rgba(239,68,68,0.08)",   border: "#ef4444", text: "#fca5a5", dot: "#ef4444", label: "Crash cause" },
  application: { bg: "rgba(59,130,246,0.08)",  border: "#3b82f6", text: "#93c5fd", dot: "#3b82f6", label: "Application" },
  framework:   { bg: "rgba(249,115,22,0.08)",  border: "#f97316", text: "#fdba74", dot: "#f97316", label: "Framework" },
  library:     { bg: "rgba(107,114,128,0.06)", border: "#4b5563", text: "#9ca3af", dot: "#6b7280", label: "Library" },
} as const;

type FrameType = keyof typeof FRAME_STYLE;

export default function StackTraceSection({ stackTrace, rawStackTrace, expanded }: StackTraceSectionProps) {
  const [openFrames, setOpenFrames] = useState<Set<number>>(new Set([0, 1]));
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";

  const toggle = (idx: number) => {
    const n = new Set(openFrames);
    n.has(idx) ? n.delete(idx) : n.add(idx);
    setOpenFrames(n);
  };

  if (stackTrace?.frames?.length) {
    return (
      <div>
        {/* Legend */}
        <div style={{ display: "flex", gap: "14px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
          {(Object.entries(FRAME_STYLE) as [FrameType, (typeof FRAME_STYLE)[FrameType]][]).map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: v.dot, display: "inline-block" }} />
              <span style={{ color: "#9ca3af", fontSize: "11px" }}>{v.label}</span>
            </div>
          ))}
          <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono, marginLeft: "auto" }}>
            {stackTrace.totalFrames} frames
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {stackTrace.frames.map((frame, idx) => {
            const type: FrameType = (frame.type in FRAME_STYLE ? frame.type : "library") as FrameType;
            const c = FRAME_STYLE[type];
            const isOpen = openFrames.has(idx);

            return (
              <div
                key={idx}
                onClick={() => toggle(idx)}
                style={{
                  background: isOpen ? c.bg : "transparent",
                  borderLeft: `3px solid ${isOpen ? c.border : "transparent"}`,
                  padding: "7px 12px",
                  cursor: "pointer",
                  borderRadius: "0 4px 4px 0",
                  transition: "all .15s",
                  outline: frame.isErrorOrigin ? "1px solid rgba(239,68,68,0.25)" : "none",
                  outlineOffset: "-1px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono, width: "22px", textAlign: "right", flexShrink: 0 }}>
                    [{frame.index}]
                  </span>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: c.dot, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ color: c.text, fontSize: "12.5px", fontFamily: mono, flex: 1, wordBreak: "break-all" }}>
                    {frame.method}
                  </span>
                  {frame.isErrorOrigin && (
                    <span style={{ fontSize: "9px", fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", padding: "2px 6px", borderRadius: "3px", fontFamily: mono, flexShrink: 0 }}>
                      ORIGIN
                    </span>
                  )}
                </div>
                {isOpen && frame.context && (
                  <div style={{ marginTop: "4px", marginLeft: "38px", color: "#9ca3af", fontSize: "12px", lineHeight: 1.5 }}>
                    {frame.context}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {stackTrace.errorFrame && (
          <div style={{ marginTop: "10px", padding: "6px 12px", background: "rgba(239,68,68,0.06)", borderRadius: "4px", border: "1px solid rgba(239,68,68,0.15)" }}>
            <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>Error frame: </span>
            <code style={{ color: "#fca5a5", fontSize: "11px", fontFamily: mono }}>{stackTrace.errorFrame}</code>
          </div>
        )}
      </div>
    );
  }

  if (rawStackTrace) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
          <CopyBtn text={rawStackTrace} />
        </div>
        <pre style={{
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "6px",
          padding: "14px",
          fontSize: "11px",
          color: "#d1d5db",
          fontFamily: mono,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          margin: 0,
          maxHeight: expanded ? "none" : "360px",
          overflowY: "auto",
        }}>
          {rawStackTrace}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "32px", color: "#4b5563", fontSize: "13px" }}>
      No stack trace information available
    </div>
  );
}
