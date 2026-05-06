import { useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
}

export default function Section({ title, children, actions, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: "4px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: open ? "12px" : 0,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            color: "#6b7280",
            fontSize: "10px",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform .15s",
            display: "inline-block",
          }}>▶</span>
          <span style={{
            color: "#6b7280",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: ".12em",
            fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)",
          }}>{title}</span>
        </div>
        {actions && open && (
          <div onClick={e => e.stopPropagation()}>{actions}</div>
        )}
      </div>
      {open && children}
    </div>
  );
}
