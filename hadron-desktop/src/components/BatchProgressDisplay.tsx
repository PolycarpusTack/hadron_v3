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
        <div className="mb-4 bg-gray-800/60 border border-gray-700 rounded-lg p-4 text-sm">
          <div className="font-semibold text-gray-100">
            Batch analysis: {batchProgress.processed} / {batchProgress.total} completed
          </div>
          {batchProgress.currentFile && (
            <div className="text-xs text-gray-400 truncate mt-1">
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
        <div className="mb-4 bg-gray-800/40 border border-gray-700 rounded-lg p-3 text-xs text-gray-300">
          {batchSummary}
        </div>
      )}
    </>
  );
}
