import type { ReactNode } from "react";

interface InfoCardProps {
  label: string;
  value: ReactNode;
  accent: string;
  sub?: string;
}

export default function InfoCard({ label, value, accent, sub }: InfoCardProps) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderTop: `2px solid ${accent}`,
      borderRadius: "0 0 6px 6px",
      padding: "12px",
    }}>
      <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)" }}>
        {label}
      </div>
      <div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "4px", fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)" }}>
        {value}
      </div>
      {sub && <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "3px" }}>{sub}</div>}
    </div>
  );
}
