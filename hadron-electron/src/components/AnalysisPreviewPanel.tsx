import { Eye, Trash2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Analysis } from "../services/api";
import Button from "./ui/Button";

interface AnalysisPreviewPanelProps {
  analysis: Analysis;
  onOpen: () => void;
  onDelete?: () => void;
}

function getSeverityBadgeClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "hd-badge hd-badge-critical";
    case "high":
      return "hd-badge hd-badge-high";
    case "medium":
      return "hd-badge hd-badge-medium";
    case "low":
      return "hd-badge hd-badge-low";
    default:
      return "hd-badge hd-badge-neutral";
  }
}

export default function AnalysisPreviewPanel({ analysis, onOpen, onDelete }: AnalysisPreviewPanelProps) {
  return (
    <div className="hd-panel p-5 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text-muted)' }}>Preview</h3>
        <span className={getSeverityBadgeClass(analysis.severity)}>
          {analysis.severity.toUpperCase()}
        </span>
      </div>

      <div>
        <h4 className="font-semibold text-base truncate" style={{ color: 'var(--hd-text)' }}>
          {analysis.filename}
        </h4>
        <p className="text-xs mt-1" style={{ color: 'var(--hd-text-dim)' }}>
          {format(new Date(analysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}
          {" · "}
          {formatDistanceToNow(new Date(analysis.analyzed_at), { addSuffix: true })}
        </p>
      </div>

      {/* Error Type */}
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--hd-text-dim)' }}>Error Type</label>
        <p className="text-sm" style={{ color: 'var(--hd-text)' }}>{analysis.error_type}</p>
        {analysis.component && (
          <p className="text-xs font-mono text-emerald-400">{analysis.component}</p>
        )}
      </div>

      {/* Root Cause */}
      {analysis.root_cause && (
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--hd-text-dim)' }}>Root Cause</label>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--hd-text-muted)' }}>
            {analysis.root_cause}
          </p>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-2 text-xs" style={{ color: 'var(--hd-text-dim)' }}>
        <div className="flex justify-between">
          <span>Analysis Type</span>
          <span className="hd-badge hd-badge-neutral">
            {analysis.analysis_type === "whatson" || analysis.analysis_type === "comprehensive"
              ? "Comprehensive"
              : analysis.analysis_type === "quick"
                ? "Quick"
                : analysis.analysis_type || "Standard"}
          </span>
        </div>
        {analysis.analysis_mode && (
          <div className="flex justify-between">
            <span>Mode</span>
            <span>{analysis.analysis_mode}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>File Size</span>
          <span>{analysis.file_size_kb.toFixed(1)} KB</span>
        </div>
        <div className="flex justify-between">
          <span>Cost</span>
          <span>${analysis.cost.toFixed(4)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--hd-border-subtle)' }}>
        <Button variant="primary" size="sm" fullWidth icon={<Eye />} onClick={onOpen}>
          Open Full Detail
        </Button>
        {onDelete && (
          <Button variant="ghost-danger" size="sm" fullWidth icon={<Trash2 />} onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
