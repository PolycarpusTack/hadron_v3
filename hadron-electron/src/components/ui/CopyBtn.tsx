import { useState } from "react";

interface CopyBtnProps {
  text: string;
  label?: string;
}

export default function CopyBtn({ text, label = "Copy" }: CopyBtnProps) {
  const [ok, setOk] = useState(false);

  const handle = () => {
    navigator.clipboard?.writeText(text);
    setOk(true);
    setTimeout(() => setOk(false), 2000);
  };

  return (
    <button
      onClick={handle}
      style={{
        background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
        color: ok ? "#6ee7b7" : "#9ca3af",
        padding: "4px 10px",
        borderRadius: "4px",
        fontSize: "11px",
        cursor: "pointer",
        fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)",
        transition: "all .2s",
      }}
    >
      {ok ? "✓ Copied" : label}
    </button>
  );
}
