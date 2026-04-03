import { useState } from 'react';
import { SentryIssue } from '../../services/api';
import { getLevelColor, getStatusColor, formatCount, formatRelativeTime } from './sentryHelpers';

interface SentryIssueRowProps {
  issue: SentryIssue;
  onAnalyze: (issueId: string) => void;
}

export function SentryIssueRow({ issue, onAnalyze }: SentryIssueRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Collapsed row — always visible, clickable to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        {/* Expand chevron */}
        <span className="flex-shrink-0 text-gray-400 text-xs">
          {expanded ? '▼' : '▶'}
        </span>

        {/* Title */}
        <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate" title={issue.title}>
          {issue.title}
        </span>

        {/* Level badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${getLevelColor(issue.level)}`}>
          {issue.level}
        </span>

        {/* Platform */}
        {issue.platform && (
          <span className="flex-shrink-0 text-xs text-gray-500 hidden sm:block">
            {issue.platform}
          </span>
        )}

        {/* Status badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${getStatusColor(issue.status)}`}>
          {issue.status}
        </span>

        {/* Event count */}
        <span className="flex-shrink-0 text-xs text-gray-600 hidden md:flex items-center gap-1">
          <span className="text-gray-400">events</span>
          {formatCount(issue.count)}
        </span>

        {/* User count */}
        {issue.userCount != null && (
          <span className="flex-shrink-0 text-xs text-gray-600 hidden md:flex items-center gap-1">
            <span className="text-gray-400">users</span>
            {formatCount(issue.userCount)}
          </span>
        )}

        {/* Last seen */}
        <span className="flex-shrink-0 text-xs text-gray-500 whitespace-nowrap">
          {formatRelativeTime(issue.lastSeen)}
        </span>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
          {/* Meta info */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
            {issue.shortId && (
              <div>
                <span className="font-semibold text-gray-500">Short ID: </span>
                {issue.shortId}
              </div>
            )}
            <div>
              <span className="font-semibold text-gray-500">Issue ID: </span>
              {issue.id}
            </div>
            <div>
              <span className="font-semibold text-gray-500">First seen: </span>
              {issue.firstSeen ? new Date(issue.firstSeen).toLocaleString() : '—'}
            </div>
            <div>
              <span className="font-semibold text-gray-500">Last seen: </span>
              {issue.lastSeen ? new Date(issue.lastSeen).toLocaleString() : '—'}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAnalyze(issue.id)}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
            >
              Analyze
            </button>
            {issue.permalink && (
              <a
                href={issue.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors"
              >
                View in Sentry ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SentryIssueRow;
