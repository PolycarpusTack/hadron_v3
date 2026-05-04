import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, Check, X } from 'lucide-react';
import Button from './ui/Button';
import { GoldAnalysis } from '../types';
import logger from '../services/logger';
import { getSeverityBadgeClasses } from '../utils/severity';

interface GoldReviewQueueProps {
  onClose?: () => void;
}

export const GoldReviewQueue: React.FC<GoldReviewQueueProps> = ({ onClose }) => {
  const [pending, setPending] = useState<GoldAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"pending" | "rejected">("pending");

  useEffect(() => {
    loadPendingGoldAnalyses(viewMode);
  }, [viewMode]);

  const loadPendingGoldAnalyses = async (mode: "pending" | "rejected") => {
    setLoading(true);
    setError(null);
    try {
      const result = mode === "pending"
        ? await invoke<GoldAnalysis[]>('get_pending_gold_analyses')
        : await invoke<GoldAnalysis[]>('get_rejected_gold_analyses');
      setPending(result);
    } catch (err) {
      logger.error('Failed to load pending gold analyses', { error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (id: number) => {
    setProcessing(id);
    try {
      await invoke('verify_gold_analysis', { goldAnalysisId: id, verifiedBy: "manual" });
      // Refresh the list
      await loadPendingGoldAnalyses(viewMode);
    } catch (err) {
      logger.error('Failed to verify gold analysis', { error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: number) => {
    setProcessing(id);
    try {
      await invoke('reject_gold_analysis', { goldAnalysisId: id, verifiedBy: "manual" });
      // Refresh the list
      await loadPendingGoldAnalyses(viewMode);
    } catch (err) {
      logger.error('Failed to reject gold analysis', { error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const handleReopen = async (id: number) => {
    setProcessing(id);
    try {
      await invoke('reopen_gold_analysis', { goldAnalysisId: id });
      await loadPendingGoldAnalyses(viewMode);
    } catch (err) {
      logger.error('Failed to reopen gold analysis', { error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("pending")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === "pending"
                  ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200"
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setViewMode("rejected")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === "rejected"
                  ? "bg-red-600/20 text-red-300 border border-red-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200"
              }`}
            >
              Rejected
            </button>
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
              <p className="text-gray-400 text-lg font-medium">
                {viewMode === "pending" ? "No pending reviews" : "No rejected reviews"}
              </p>
              <p className="text-gray-500 text-sm mt-2">
                {viewMode === "pending" ? "All gold analyses have been reviewed" : "No rejected gold analyses"}
              </p>
            </div>
          )}

          {!loading && !error && pending.length > 0 && (
            <div className="space-y-4">
              {pending.map((analysis) => (
                <div
                  key={analysis.id}
                  className={`bg-gray-800 border rounded-lg p-5 transition-colors ${
                    viewMode === "rejected"
                      ? "border-red-700/40 hover:border-red-600/60"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-white">
                          {analysis.errorSignature}
                        </h3>
                        {viewMode === "rejected" && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            Rejected
                          </span>
                        )}
                        {analysis.severity && (
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getSeverityBadgeClasses(analysis.severity || "")}`}>
                            {analysis.severity}
                          </span>
                        )}
                      </div>
                      {analysis.component && (
                        <p className="text-sm text-gray-400">
                          Component: <span className="text-gray-300">{analysis.component}</span>
                        </p>
                      )}
                      {analysis.verifiedBy && (
                        <p className="text-xs text-gray-500 mt-1">
                          Reviewed by: <span className="text-gray-300">{analysis.verifiedBy}</span>
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
                    {viewMode === "rejected" ? (
                      <Button
                        onClick={() => handleReopen(analysis.id)}
                        disabled={processing === analysis.id}
                        variant="primary"
                        size="lg"
                        loading={processing === analysis.id}
                        icon={<ArrowRight />}
                        className="flex-1 justify-center font-medium"
                      >
                        {processing === analysis.id ? "Processing..." : "Reopen for Review"}
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => handleVerify(analysis.id)}
                          disabled={processing === analysis.id}
                          variant="success"
                          size="lg"
                          loading={processing === analysis.id}
                          icon={<Check />}
                          className="flex-1 justify-center font-medium"
                        >
                          {processing === analysis.id ? "Processing..." : "Verify"}
                        </Button>
                        <Button
                          onClick={() => handleReject(analysis.id)}
                          disabled={processing === analysis.id}
                          variant="danger"
                          size="lg"
                          loading={processing === analysis.id}
                          icon={<X />}
                          className="flex-1 justify-center font-medium"
                        >
                          {processing === analysis.id ? "Processing..." : "Reject"}
                        </Button>
                      </>
                    )}
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
          <Button
            onClick={() => loadPendingGoldAnalyses(viewMode)}
            disabled={loading}
            variant="secondary"
            loading={loading}
            className="font-medium"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GoldReviewQueue;
