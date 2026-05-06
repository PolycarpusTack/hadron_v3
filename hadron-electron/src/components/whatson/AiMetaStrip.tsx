import type { Analysis } from "../../services/api";
import Tag from "../ui/Tag";

export default function AiMetaStrip({ analysis }: { analysis: Analysis }) {
  const mono = "var(--hd-font-mono,'JetBrains Mono',monospace)";
  const sep = <span style={{ color: "#2a2a2e" }}>│</span>;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 0",
      borderTop: "1px solid rgba(255,255,255,0.04)",
      marginTop: "8px",
      flexWrap: "wrap",
    }}>
      <Tag text="Hadron AI" color="#8b5cf6" />
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{analysis.ai_model}</span>
      {analysis.ai_provider && <>{sep}<span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{analysis.ai_provider}</span></>}
      {sep}
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{analysis.tokens_used.toLocaleString()} tokens</span>
      {sep}
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>${analysis.cost.toFixed(4)}</span>
      {analysis.analysis_duration_ms != null && (
        <>{sep}<span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{(analysis.analysis_duration_ms / 1000).toFixed(1)}s</span></>
      )}
      {analysis.analysis_mode && <Tag text={analysis.analysis_mode} color="#6b7280" />}
    </div>
  );
}
