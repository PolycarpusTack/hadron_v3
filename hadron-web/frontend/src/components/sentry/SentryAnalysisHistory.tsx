import { useState, useEffect, type MouseEvent } from 'react';
import { SentryAnalysisSummary } from '../../services/api';
import { api } from '../../services/api';
import { getSeverityColor, formatRelativeTime } from './sentryHelpers';

interface SentryAnalysisHistoryProps {
  onView: (id: number) => void;
}

export function SentryAnalysisHistory({ onView }: SentryAnalysisHistoryProps) {
  const [analyses, setAnalyses] = useState<SentryAnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadAnalyses = async () => {
    setLoading(true);
    try {
      const res = await api.getSentryAnalyses(50);
      setAnalyses(res.items);
    } catch {
      setAnalyses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyses();
  }, []);

  const handleDelete = async (e: MouseEvent, id: number) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await api.deleteSentryAnalysis(id);
      await loadAnalyses();
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = analyses.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.filename.toLowerCase().includes(q) ||
      (a.errorType ?? '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-400">
        Loading analyses…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by filename or error type…"
        className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
      />

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          {analyses.length === 0
            ? 'No Sentry analyses yet. Analyze an issue to see it here.'
            : 'No analyses match your search.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((analysis) => (
            <li
              key={analysis.id}
              onClick={() => onView(analysis.id)}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-slate-600 hover:bg-slate-750 transition-colors"
            >
              {/* Severity badge */}
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${getSeverityColor(analysis.severity)}`}
              >
                {analysis.severity ?? 'N/A'}
              </span>

              {/* Error type + filename */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-200">
                  {analysis.errorType ?? 'Unknown error'}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {analysis.filename}
                </div>
              </div>

              {/* Relative time */}
              <span className="shrink-0 text-xs text-slate-500">
                {formatRelativeTime(analysis.analyzedAt)}
              </span>

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(e, analysis.id)}
                disabled={deletingId === analysis.id}
                aria-label="Delete analysis"
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {deletingId === analysis.id ? '…' : 'Del'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
