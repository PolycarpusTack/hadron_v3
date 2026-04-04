import { useState } from 'react';
import { SentryAnalysisFullData } from '../../services/api';
import { getSeverityColor } from './sentryHelpers';
import { SentryPatternCard } from './SentryPatternCard';
import { SentryBreadcrumbTimeline } from './SentryBreadcrumbTimeline';
import { SentryExceptionChain } from './SentryExceptionChain';
import SentryRuntimeContext from './SentryRuntimeContext';
import SentryUserImpact from './SentryUserImpact';
import SentryRecommendations from './SentryRecommendations';

interface SentryDetailViewProps {
  data: SentryAnalysisFullData;
  onBack: () => void;
}

const TABS = [
  'Overview',
  'Patterns',
  'Breadcrumbs',
  'Stack Trace',
  'Context',
  'Impact',
  'Recommendations',
];

export default function SentryDetailView({ data, onBack }: SentryDetailViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  async function handleCopyReport() {
    const lines = [
      `Sentry Analysis: ${data.issue.title}`,
      `Severity: ${data.aiResult.severity}`,
      `Error Type: ${data.aiResult.errorType}`,
      `Component: ${data.aiResult.component}`,
      '',
      'Root Cause:',
      data.aiResult.rootCause,
      '',
      'Suggested Fixes:',
      ...data.aiResult.suggestedFixes.map((f, i) => `${i + 1}. ${f}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed (e.g. permissions denied) — silently ignore
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {data.issue.title}
          </h2>
        </div>

        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getSeverityColor(data.aiResult.severity)}`}
        >
          {data.aiResult.severity}
        </span>

        {data.issue.permalink && (
          <a
            href={data.issue.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex-shrink-0"
          >
            View in Sentry
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}

        <button
          onClick={handleCopyReport}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          {copied ? 'Copied!' : 'Copy Report'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0 overflow-x-auto">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            onClick={() => setActiveTab(index)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
              activeTab === index
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Tab 0: Overview */}
        {activeTab === 0 && (
          <div className="space-y-4 max-w-3xl">
            {/* Badge row */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                {data.aiResult.errorType}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getSeverityColor(data.aiResult.severity)}`}
              >
                Severity: {data.aiResult.severity}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                Confidence: {data.aiResult.confidence}
              </span>
              {data.aiResult.component && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  {data.aiResult.component}
                </span>
              )}
            </div>

            {/* Root cause */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Root Cause
              </h3>
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {data.aiResult.rootCause}
              </p>
            </div>

            {/* Suggested fixes */}
            {data.aiResult.suggestedFixes.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Suggested Fixes
                </h3>
                <ol className="space-y-2">
                  {data.aiResult.suggestedFixes.map((fix, i) => (
                    <li key={i} className="flex gap-3 text-sm text-gray-800 dark:text-gray-200">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-semibold">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{fix}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Patterns */}
        {activeTab === 1 && (
          <SentryPatternCard
            patterns={data.patterns}
            aiPatternType={data.aiResult.patternType}
          />
        )}

        {/* Tab 2: Breadcrumbs */}
        {activeTab === 2 && (
          <SentryBreadcrumbTimeline breadcrumbs={data.event.breadcrumbs} />
        )}

        {/* Tab 3: Stack Trace */}
        {activeTab === 3 && (
          <SentryExceptionChain exceptions={data.event.exceptions} />
        )}

        {/* Tab 4: Context */}
        {activeTab === 4 && (
          <SentryRuntimeContext
            contexts={data.event.contexts}
            tags={data.event.tags}
          />
        )}

        {/* Tab 5: Impact */}
        {activeTab === 5 && (
          <SentryUserImpact
            issue={data.issue}
            userImpact={data.aiResult.userImpact}
          />
        )}

        {/* Tab 6: Recommendations */}
        {activeTab === 6 && (
          <SentryRecommendations recommendations={data.aiResult.recommendations} />
        )}
      </div>
    </div>
  );
}
