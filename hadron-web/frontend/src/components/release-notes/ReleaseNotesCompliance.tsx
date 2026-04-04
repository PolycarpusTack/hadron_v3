import { useState } from "react";
import { api, ComplianceReport } from "../../services/api";

interface ReleaseNotesComplianceProps {
  noteId: number;
}

export function ReleaseNotesCompliance({ noteId }: ReleaseNotesComplianceProps) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRunCheck() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.runComplianceCheck(noteId);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compliance check failed");
    } finally {
      setLoading(false);
    }
  }

  const scoreStyle =
    report === null
      ? ""
      : report.score >= 80
        ? "bg-green-100 text-green-800"
        : report.score >= 50
          ? "bg-yellow-100 text-yellow-800"
          : "bg-red-100 text-red-800";

  const hasViolations =
    report !== null &&
    (report.terminologyViolations.length > 0 ||
      report.structureViolations.length > 0 ||
      report.screenshotSuggestions.length > 0);

  return (
    <div className="space-y-4">
      {/* Run button */}
      <button
        onClick={handleRunCheck}
        disabled={loading}
        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
      >
        Run Compliance Check
      </button>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          Checking compliance...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {report !== null && !loading && (
        <div className="space-y-4">
          {/* Score */}
          <div className={`inline-flex items-end gap-2 rounded-lg px-4 py-3 ${scoreStyle}`}>
            <span className="text-5xl font-bold tabular-nums">{report.score}</span>
            <span className="mb-1 text-sm font-medium">/ 100 Compliance Score</span>
          </div>

          {/* All clear */}
          {!hasViolations && (
            <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              All clear! No compliance issues found.
            </div>
          )}

          {/* Terminology violations */}
          {report.terminologyViolations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700">
                Terminology Issues ({report.terminologyViolations.length})
              </h4>
              {report.terminologyViolations.map((v, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
                >
                  <p className="font-semibold text-slate-800">
                    Found:{" "}
                    <span className="text-amber-700">{v.term}</span>
                    {" → "}
                    Should be:{" "}
                    <span className="text-green-700">{v.correctTerm}</span>
                  </p>
                  {v.context && (
                    <p className="mt-1 italic text-slate-500">&ldquo;{v.context}&rdquo;</p>
                  )}
                  {v.suggestion && (
                    <p className="mt-1 text-slate-600">{v.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Structure violations */}
          {report.structureViolations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700">
                Structure Issues ({report.structureViolations.length})
              </h4>
              {report.structureViolations.map((v, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm"
                >
                  <p className="font-semibold text-slate-800">{v.rule}</p>
                  {v.description && (
                    <p className="mt-1 text-slate-600">{v.description}</p>
                  )}
                  {v.location && (
                    <p className="mt-1 text-xs text-slate-400">Location: {v.location}</p>
                  )}
                  {v.suggestion && (
                    <p className="mt-1 italic text-slate-600">{v.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Screenshot suggestions */}
          {report.screenshotSuggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700">
                Screenshot Suggestions ({report.screenshotSuggestions.length})
              </h4>
              {report.screenshotSuggestions.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm"
                >
                  {s.location && (
                    <p className="font-medium text-slate-700">{s.location}</p>
                  )}
                  {s.description && (
                    <p className="mt-1 text-slate-600">{s.description}</p>
                  )}
                  {s.reason && (
                    <p className="mt-1 text-xs text-slate-400">{s.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
