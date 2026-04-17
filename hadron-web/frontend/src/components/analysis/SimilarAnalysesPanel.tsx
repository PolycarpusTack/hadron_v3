import { useEffect, useState } from "react";
import { api, type SimilarAnalysis } from "../../services/api";
import { SeverityBadge } from "../common/SeverityBadge";
import { useToast } from "../Toast";

interface SimilarAnalysesPanelProps {
  analysisId: number;
}

export function SimilarAnalysesPanel({
  analysisId,
}: SimilarAnalysesPanelProps) {
  const toast = useToast();
  const [similar, setSimilar] = useState<SimilarAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasEmbedding, setHasEmbedding] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Try to load similar analyses (will 404 if no embedding)
    setLoading(true);
    api
      .getSimilarAnalyses(analysisId, { limit: 5 })
      .then((data) => {
        setSimilar(data);
        setHasEmbedding(true);
      })
      .catch(() => {
        setHasEmbedding(false);
      })
      .finally(() => setLoading(false));
  }, [analysisId]);

  const handleGenerateEmbedding = async () => {
    setGenerating(true);
    try {
      await api.embedAnalysis(analysisId);
      toast.success("Embedding generated");
      // Reload similar
      const data = await api.getSimilarAnalyses(analysisId, { limit: 5 });
      setSimilar(data);
      setHasEmbedding(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate embedding");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-300">
          Similar Analyses
        </span>
        <span className="text-xs text-slate-500">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-700 px-4 py-3">
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : hasEmbedding === false ? (
            <div className="text-center">
              <p className="mb-2 text-sm text-slate-400">
                No embedding exists for this analysis.
              </p>
              <button
                onClick={handleGenerateEmbedding}
                disabled={generating}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {generating ? "Generating..." : "Generate Embedding"}
              </button>
            </div>
          ) : similar.length === 0 ? (
            <p className="text-sm text-slate-400">
              No similar analyses found.
            </p>
          ) : (
            <div className="space-y-2">
              {similar.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md bg-slate-900 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">
                      {s.filename}
                    </div>
                    {s.errorType && (
                      <div className="text-xs text-slate-500">
                        {s.errorType}
                      </div>
                    )}
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <SeverityBadge severity={s.severity} />
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                      {(s.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
