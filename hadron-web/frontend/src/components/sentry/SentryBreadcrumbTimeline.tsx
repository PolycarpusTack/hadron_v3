import { SentryBreadcrumb } from '../../services/api';

interface SentryBreadcrumbTimelineProps {
  breadcrumbs: SentryBreadcrumb[];
}

function getLevelDotColor(level: string | null): string {
  switch (level) {
    case 'error':
    case 'fatal':
      return 'bg-red-500';
    case 'warning':
      return 'bg-yellow-400';
    case 'info':
      return 'bg-blue-400';
    case 'debug':
      return 'bg-gray-400';
    default:
      return 'bg-gray-400';
  }
}

function getCategoryBadge(category: string | null): { label: string; cls: string } {
  if (!category) return { label: 'other', cls: 'bg-gray-100 text-gray-600' };
  const lower = category.toLowerCase();
  if (lower === 'http' || lower.startsWith('http')) {
    return { label: category, cls: 'bg-blue-100 text-blue-700' };
  }
  if (lower === 'query' || lower === 'db' || lower.startsWith('db.')) {
    return { label: category, cls: 'bg-purple-100 text-purple-700' };
  }
  if (lower === 'ui.click' || lower.startsWith('ui')) {
    return { label: category, cls: 'bg-green-100 text-green-700' };
  }
  return { label: category, cls: 'bg-gray-100 text-gray-600' };
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function SentryBreadcrumbTimeline({ breadcrumbs }: SentryBreadcrumbTimelineProps) {
  if (breadcrumbs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No breadcrumbs available.
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className="absolute left-2 top-0 bottom-0 border-l-2 border-gray-200" />

      <div className="space-y-2">
        {breadcrumbs.map((bc, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          const dotColor = getLevelDotColor(bc.level);
          const timeStr = formatTime(bc.timestamp);
          const badge = getCategoryBadge(bc.category);

          return (
            <div
              key={idx}
              className={`relative flex items-start gap-3 rounded-md px-3 py-2 ${
                isLast
                  ? 'border border-red-300 bg-red-50'
                  : 'bg-white border border-gray-100'
              }`}
            >
              {/* Dot on the timeline line */}
              <div
                className={`absolute -left-[1.15rem] mt-1.5 h-3 w-3 flex-shrink-0 rounded-full border-2 border-white ${dotColor}`}
              />

              {/* Timestamp */}
              {timeStr && (
                <span className="flex-shrink-0 font-mono text-xs text-gray-400 mt-0.5 w-16">
                  {timeStr}
                </span>
              )}

              {/* Category badge */}
              <span
                className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}
              >
                {badge.label}
              </span>

              {/* Message */}
              <span className={`text-sm leading-snug ${isLast ? 'text-red-800 font-medium' : 'text-gray-700'}`}>
                {bc.message ?? <span className="italic text-gray-400">no message</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SentryBreadcrumbTimeline;
