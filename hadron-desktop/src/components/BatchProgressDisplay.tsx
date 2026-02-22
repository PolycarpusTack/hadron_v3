interface BatchProgress {
  total: number;
  processed: number;
  failed: number;
  currentFile?: string;
}

interface BatchProgressDisplayProps {
  batchProgress: BatchProgress | null;
  batchSummary: string | null;
  isAnalyzing: boolean;
}

export default function BatchProgressDisplay({
  batchProgress,
  batchSummary,
  isAnalyzing,
}: BatchProgressDisplayProps) {
  return (
    <>
      {batchProgress && (
        <div className="mb-4 rounded-lg p-4 text-sm" style={{ background: 'var(--hd-bg-surface)', border: '1px solid var(--hd-border)' }}>
          <div className="font-semibold" style={{ color: 'var(--hd-text)' }}>
            Batch analysis: {batchProgress.processed} / {batchProgress.total} ({Math.round((batchProgress.processed / batchProgress.total) * 100)}%) completed
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--hd-bg-raised)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.round((batchProgress.processed / batchProgress.total) * 100)}%`,
                background: 'linear-gradient(90deg, #059669, #10b981)',
              }}
            />
          </div>
          {batchProgress.currentFile && (
            <div className="text-xs truncate mt-1" style={{ color: 'var(--hd-text-dim)' }}>
              Current file: {batchProgress.currentFile}
            </div>
          )}
          {batchProgress.failed > 0 && (
            <div className="text-xs text-red-400 mt-1">
              Failed: {batchProgress.failed}
            </div>
          )}
        </div>
      )}
      {batchSummary && !isAnalyzing && (
        <div className="mb-4 rounded-lg p-3 text-xs" style={{ background: 'var(--hd-bg-surface)', border: '1px solid var(--hd-border)', color: 'var(--hd-text-muted)' }}>
          {batchSummary}
        </div>
      )}
    </>
  );
}
