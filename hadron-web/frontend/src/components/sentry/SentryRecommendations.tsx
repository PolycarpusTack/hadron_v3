import { useState } from 'react';
import { SentryRecommendation } from '../../services/api';
import { getPriorityColor, getEffortColor, capitalize } from './sentryHelpers';

interface SentryRecommendationsProps {
  recommendations: SentryRecommendation[];
}

function priorityBorderColor(priority: string): string {
  switch (priority) {
    case 'high': return 'border-l-red-500';
    case 'medium': return 'border-l-yellow-500';
    case 'low': return 'border-l-green-500';
    default: return 'border-l-gray-400';
  }
}

interface RecommendationCardProps {
  rec: SentryRecommendation;
  index: number;
}

function RecommendationCard({ rec, index }: RecommendationCardProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!rec.codeSnippet) return;
    navigator.clipboard.writeText(rec.codeSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className={`bg-white border border-gray-200 border-l-4 ${priorityBorderColor(rec.priority)} rounded-lg p-4 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getPriorityDotClass(rec.priority)}`} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${getPriorityColor(rec.priority)}`}>
            {rec.priority}
          </span>
          <span className="text-xs text-gray-400">#{index + 1}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getEffortColor(rec.effort)}`}>
          {capitalize(rec.effort)} effort
        </span>
      </div>

      <h4 className="text-sm font-semibold text-gray-900 mb-1">{rec.title}</h4>
      <p className="text-sm text-gray-600 leading-relaxed mb-3">{rec.description}</p>

      {rec.codeSnippet && (
        <div className="relative">
          <div className="flex items-center justify-between bg-gray-800 rounded-t-md px-3 py-1.5">
            <span className="text-xs text-gray-400 font-mono">code</span>
            <button
              onClick={handleCopy}
              className="text-xs text-gray-300 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-gray-900 text-gray-100 text-xs font-mono p-3 rounded-b-md overflow-x-auto">
            <code>{rec.codeSnippet}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function getPriorityDotClass(priority: string): string {
  switch (priority) {
    case 'high': return 'bg-red-500';
    case 'medium': return 'bg-yellow-500';
    case 'low': return 'bg-green-500';
    default: return 'bg-gray-400';
  }
}

export default function SentryRecommendations({ recommendations }: SentryRecommendationsProps) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic py-4">No recommendations available.</div>
    );
  }

  return (
    <div className="space-y-3">
      {recommendations.map((rec, i) => (
        <RecommendationCard key={i} rec={rec} index={i} />
      ))}
    </div>
  );
}
