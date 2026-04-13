import { useState } from 'react';
import { api, PerformanceTraceResult } from '../../services/api';
import { PerformanceFileUpload } from './PerformanceFileUpload';
import { PerformanceResults } from './PerformanceResults';

export function PerformanceAnalyzerView() {
  const [result, setResult] = useState<PerformanceTraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiEnrich, setAiEnrich] = useState(true);

  async function handleAnalyze(content: string, filename: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = aiEnrich
        ? await api.analyzePerformanceTraceEnriched(content, filename)
        : await api.analyzePerformanceTrace(content, filename);
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <span className="w-1 h-7 bg-teal-500 rounded-full inline-block" aria-hidden />
            Performance Analyzer
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Analyze .NET / CLR performance trace logs for hotspots, GC pressure, and actionable recommendations.
          </p>
        </div>
        {result && (
          <button
            onClick={handleReset}
            className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
          >
            New Analysis
          </button>
        )}
      </div>

      {/* AI Enrich toggle — always visible */}
      {!result && (
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={aiEnrich}
            onChange={(e) => setAiEnrich(e.target.checked)}
            disabled={loading}
            className="w-4 h-4 accent-teal-500 cursor-pointer disabled:opacity-50"
          />
          <span className="text-sm text-slate-300">
            AI Enrich
            <span className="ml-1 text-slate-500 text-xs">
              (generates scenario, recommendations &amp; deeper insights)
            </span>
          </span>
        </label>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          <span className="font-medium">Error: </span>{error}
        </div>
      )}

      {/* Upload phase */}
      {!result && (
        <PerformanceFileUpload onAnalyze={handleAnalyze} loading={loading} />
      )}

      {/* Results phase */}
      {result && (
        <PerformanceResults result={result} />
      )}
    </div>
  );
}
