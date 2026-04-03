import { useState, useEffect } from 'react';
import { api, SentryAnalysisFullData } from '../../services/api';
import { useAiStream } from '../../hooks/useAiStream';
import { SentryIssueBrowser } from './SentryIssueBrowser';
import { SentryQuickImport } from './SentryQuickImport';
import { SentryAnalysisHistory } from './SentryAnalysisHistory';
import SentryDetailView from './SentryDetailView';

type ActiveTab = 'browse' | 'import' | 'history';

export function SentryAnalyzerView() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('browse');
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<SentryAnalysisFullData | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const { streamAi, content, isStreaming, error: streamError, reset } = useAiStream();

  useEffect(() => {
    api
      .getSentryConfigStatus()
      .then((status) => {
        setConfigured(status.configured);
      })
      .catch(() => {
        setConfigured(false);
      })
      .finally(() => {
        setConfigLoading(false);
      });
  }, []);

  // Watch for stream completion to fetch the saved analysis
  useEffect(() => {
    if (!isStreaming && content && analyzing) {
      setAnalyzing(false);
      try {
        // The streamed content is the raw AI response; after streaming completes,
        // fetch the latest persisted analysis from the server.
        JSON.parse(content); // validate it is parseable JSON
        api.getSentryAnalyses(1).then(({ items }: { items: Array<{ id: number }> }) => {
          if (items.length > 0) {
            api.getSentryAnalysis(items[0].id).then((full: any) => {
              if (full.fullData) {
                setAnalysisData(full.fullData as SentryAnalysisFullData);
                setShowDetail(true);
              }
            });
          }
        });
      } catch {
        setError('Failed to parse analysis result');
      }
    }
  }, [isStreaming, content, analyzing]);

  const handleAnalyze = (issueId: string) => {
    setAnalyzing(true);
    setError(null);
    reset();
    streamAi(`/sentry/issues/${encodeURIComponent(issueId)}/analyze/stream`, {});
  };

  const handleViewAnalysis = async (id: number) => {
    try {
      const full: any = await api.getSentryAnalysis(id);
      if (full.fullData) {
        setAnalysisData(full.fullData as SentryAnalysisFullData);
        setShowDetail(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analysis');
    }
  };

  // Detail view takes over the whole page
  if (showDetail && analysisData) {
    return (
      <SentryDetailView
        data={analysisData}
        onBack={() => {
          setShowDetail(false);
          setAnalysisData(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600">
          <svg
            className="h-5 w-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Sentry Analysis</h1>
          <p className="text-sm text-slate-400">
            Browse issues, analyze errors, and view AI-generated reports
          </p>
        </div>
      </div>

      {/* Config loading */}
      {configLoading && (
        <div className="flex items-center gap-2 text-slate-400">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm">Checking Sentry configuration…</span>
        </div>
      )}

      {/* Not configured banner */}
      {!configLoading && !configured && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-900/20 px-4 py-3">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-300">Sentry not configured</p>
              <p className="mt-0.5 text-sm text-amber-400/80">
                An admin needs to set up Sentry in the Admin panel before you can use this feature.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main content — only shown when configured */}
      {!configLoading && configured && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
            {(
              [
                { key: 'browse', label: 'Browse Issues' },
                { key: 'import', label: 'Quick Import' },
                { key: 'history', label: 'Analysis History' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Streaming / analyzing indicator */}
          {(analyzing || isStreaming) && (
            <div className="rounded-lg border border-emerald-600/30 bg-emerald-900/20 p-4">
              <div className="mb-2 flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-sm font-medium text-emerald-300">Analyzing issue…</span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                <div className="h-full w-full origin-left animate-pulse rounded-full bg-emerald-500" />
              </div>
              {/* Streamed content preview */}
              {content && (
                <pre className="mt-3 max-h-32 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300">
                  {content.slice(0, 500)}
                  {content.length > 500 ? '…' : ''}
                </pre>
              )}
            </div>
          )}

          {/* Error display */}
          {(error || streamError) && (
            <div className="rounded-lg border border-red-600/30 bg-red-900/20 px-4 py-3">
              <div className="flex items-start gap-2">
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                <p className="text-sm text-red-300">{error || streamError}</p>
              </div>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'browse' && (
            <SentryIssueBrowser onAnalyze={handleAnalyze} />
          )}
          {activeTab === 'import' && (
            <SentryQuickImport onAnalyze={handleAnalyze} />
          )}
          {activeTab === 'history' && (
            <SentryAnalysisHistory onView={handleViewAnalysis} />
          )}
        </div>
      )}
    </div>
  );
}
