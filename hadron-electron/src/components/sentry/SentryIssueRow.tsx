/**
 * Sentry Issue Row
 * Expandable row showing issue summary, metadata, and action buttons
 */

import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Hash,
  Loader2,
  Users,
  Zap,
} from "lucide-react";
import type { SentryIssue } from "../../types";
import { getLevelColor, getStatusColor, formatCount, formatRelativeTime } from "./sentryHelpers";

export interface SentryIssueRowProps {
  issue: SentryIssue;
  expanded: boolean;
  onToggleExpand: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

export default function SentryIssueRow({
  issue,
  expanded,
  onToggleExpand,
  onAnalyze,
  analyzing,
}: SentryIssueRowProps) {
  const levelColor = getLevelColor(issue.level);
  const statusColor = getStatusColor(issue.status);

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition">
      {/* Main Row */}
      <button
        onClick={onToggleExpand}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        {/* Level Badge */}
        <span
          className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${levelColor}`}
        >
          {issue.level}
        </span>

        {/* Title & Culprit */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white truncate">{issue.title}</p>
            {issue.project && (
              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 rounded">
                {issue.project.name || issue.project.slug}
              </span>
            )}
          </div>
          {issue.culprit && (
            <p className="text-xs text-gray-500 truncate">{issue.culprit}</p>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
          {issue.platform && (
            <span className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
              {issue.platform}
            </span>
          )}

          <span className={`px-1.5 py-0.5 rounded ${statusColor}`}>
            {issue.status}
          </span>

          {issue.count && (
            <span className="flex items-center gap-1" title="Event count">
              <Hash className="w-3 h-3" />
              {formatCount(issue.count)}
            </span>
          )}

          {issue.userCount != null && issue.userCount > 0 && (
            <span className="flex items-center gap-1" title="Affected users">
              <Users className="w-3 h-3" />
              {issue.userCount}
            </span>
          )}

          {issue.lastSeen && (
            <span className="flex items-center gap-1" title="Last seen">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(issue.lastSeen)}
            </span>
          )}

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700/50 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-500">Short ID:</span>{" "}
              <span className="text-gray-300 font-mono">{issue.shortId}</span>
            </div>
            <div>
              <span className="text-gray-500">Issue ID:</span>{" "}
              <span className="text-gray-300 font-mono">{issue.id}</span>
            </div>
            {issue.firstSeen && (
              <div>
                <span className="text-gray-500">First Seen:</span>{" "}
                <span className="text-gray-300">
                  {new Date(issue.firstSeen).toLocaleString()}
                </span>
              </div>
            )}
            {issue.lastSeen && (
              <div>
                <span className="text-gray-500">Last Seen:</span>{" "}
                <span className="text-gray-300">
                  {new Date(issue.lastSeen).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-600/50 disabled:cursor-not-allowed text-sm text-white rounded-lg transition"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  Analyze with AI
                </>
              )}
            </button>
            {issue.permalink && (
              <a
                href={issue.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 rounded-lg transition"
              >
                <ExternalLink className="w-3 h-3" />
                View in Sentry
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
