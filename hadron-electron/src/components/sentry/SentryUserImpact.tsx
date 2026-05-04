/**
 * Sentry User Impact
 * Displays the AI-generated user impact assessment and event statistics
 */

import { Users, TrendingUp, Clock } from "lucide-react";

interface SentryUserImpactProps {
  userImpact?: string;
  eventCount?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
}

export default function SentryUserImpact({
  userImpact,
  eventCount,
  userCount,
  firstSeen,
  lastSeen,
}: SentryUserImpactProps) {
  const formatCount = (count: string) => {
    const n = parseInt(count, 10);
    if (isNaN(n)) return count;
    return n.toLocaleString();
  };

  const daysBetween = (start?: string, end?: string) => {
    if (!start || !end) return null;
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(1, Math.ceil(diffMs / 86_400_000));
  };

  const duration = daysBetween(firstSeen, lastSeen);

  return (
    <div className="space-y-4">
      {/* AI User Impact Analysis */}
      {userImpact && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-orange-400" />
            <h4 className="text-sm font-semibold text-orange-400">User Impact</h4>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{userImpact}</p>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {eventCount && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <TrendingUp className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-white">{formatCount(eventCount)}</div>
            <div className="text-xs text-gray-500">Total Events</div>
          </div>
        )}

        {userCount != null && userCount > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Users className="w-5 h-5 text-orange-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-white">{userCount.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Affected Users</div>
          </div>
        )}

        {firstSeen && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Clock className="w-5 h-5 text-green-400 mx-auto mb-1" />
            <div className="text-sm font-bold text-white">
              {new Date(firstSeen).toLocaleDateString()}
            </div>
            <div className="text-xs text-gray-500">First Seen</div>
          </div>
        )}

        {duration && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
            <Clock className="w-5 h-5 text-purple-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-white">{duration}</div>
            <div className="text-xs text-gray-500">Days Active</div>
          </div>
        )}
      </div>
    </div>
  );
}
