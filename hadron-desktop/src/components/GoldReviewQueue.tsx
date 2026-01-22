import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GoldAnalysis } from '../types';

interface GoldReviewQueueProps {
  onClose?: () => void;
}

export const GoldReviewQueue: React.FC<GoldReviewQueueProps> = ({ onClose }) => {
  const [pending, setPending] = useState<GoldAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);

  useEffect(() => {
    loadPendingGoldAnalyses();
  }, []);

  const loadPendingGoldAnalyses = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<GoldAnalysis[]>('get_pending_gold_analyses');
      setPending(result);
    } catch (err) {
      console.error('Failed to load pending gold analyses:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (id: number) => {
    setProcessing(id);
    try {
      await invoke('verify_gold_analysis', { goldAnalysisId: id });
      // Refresh the list
      await loadPendingGoldAnalyses();
    } catch (err) {
      console.error('Failed to verify gold analysis:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: number) => {
    setProcessing(id);
    try {
      await invoke('reject_gold_analysis', { goldAnalysisId: id });
      // Refresh the list
      await loadPendingGoldAnalyses();
    } catch (err) {
      console.error('Failed to reject gold analysis:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const getSeverityColor = (severity?: string) => {
    if (!severity) return 'bg-gray-500/20 text-gray-400';
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'bg-red-500/20 text-red-400';
      case 'high':
        return 'bg-orange-500/20 text-orange-400';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'low':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const parseSuggestedFixes = (fixes: string): string[] => {
    try {
      const parsed = JSON.parse(fixes);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [fixes];
    } catch {
      return [fixes];
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Gold Review Queue</h2>
            <p className="text-sm text-gray-400 mt-1">
              Review and verify gold standard analyses for the knowledge base
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div>
                  <h3 className="text-red-400 font-medium">Error</h3>
                  <p className="text-red-300 text-sm mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && pending.length === 0 && (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-400 text-lg font-medium">No pending reviews</p>
              <p className="text-gray-500 text-sm mt-2">All gold analyses have been reviewed</p>
            </div>
          )}

          {!loading && !error && pending.length > 0 && (
            <div className="space-y-4">
              {pending.map((analysis) => (
                <div
                  key={analysis.id}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-5 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-white">
                          {analysis.errorSignature}
                        </h3>
                        {analysis.severity && (
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getSeverityColor(analysis.severity)}`}>
                            {analysis.severity}
                          </span>
                        )}
                      </div>
                      {analysis.component && (
                        <p className="text-sm text-gray-400">
                          Component: <span className="text-gray-300">{analysis.component}</span>
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        Created: {new Date(analysis.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 mt-4">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-300 mb-1">Root Cause</h4>
                      <p className="text-sm text-gray-400 leading-relaxed">{analysis.rootCause}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-300 mb-1">Suggested Fixes</h4>
                      <ul className="space-y-1">
                        {parseSuggestedFixes(analysis.suggestedFixes).map((fix, idx) => (
                          <li key={idx} className="text-sm text-gray-400 flex items-start">
                            <span className="text-blue-400 mr-2">•</span>
                            <span className="flex-1">{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {analysis.sourceAnalysisId && (
                      <div className="text-xs text-gray-500">
                        Source Analysis ID: {analysis.sourceAnalysisId}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 mt-5 pt-4 border-t border-gray-700">
                    <button
                      onClick={() => handleVerify(analysis.id)}
                      disabled={processing === analysis.id}
                      className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {processing === analysis.id ? (
                        <span className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          Processing...
                        </span>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Verify
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleReject(analysis.id)}
                      disabled={processing === analysis.id}
                      className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {processing === analysis.id ? (
                        <span className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          Processing...
                        </span>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Reject
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {pending.length > 0 && !loading && (
              <span>{pending.length} pending {pending.length === 1 ? 'review' : 'reviews'}</span>
            )}
          </div>
          <button
            onClick={loadPendingGoldAnalyses}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoldReviewQueue;
