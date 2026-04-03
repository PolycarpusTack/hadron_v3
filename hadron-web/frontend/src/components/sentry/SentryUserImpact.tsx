import React from 'react';
import { SentryIssue } from '../../services/api';
import { formatCount, formatRelativeTime } from './sentryHelpers';

interface SentryUserImpactProps {
  issue: SentryIssue;
  userImpact: string;
}

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

export default function SentryUserImpact({ issue, userImpact }: SentryUserImpactProps) {
  const now = Date.now();
  const firstSeenMs = issue.firstSeen ? new Date(issue.firstSeen).getTime() : now;
  const daysActive = Math.max(1, Math.ceil((now - firstSeenMs) / 86400000));

  return (
    <div className="space-y-4">
      {userImpact && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 border-l-4 border-l-emerald-500">
          <h4 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
            AI Impact Assessment
          </h4>
          <p className="text-sm text-gray-800 leading-relaxed">{userImpact}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Total Events"
          value={formatCount(issue.count)}
        />
        <StatCard
          label="Affected Users"
          value={formatCount(issue.userCount ?? null)}
        />
        <StatCard
          label="First Seen"
          value={formatRelativeTime(issue.firstSeen)}
        />
        <StatCard
          label="Days Active"
          value={String(daysActive)}
        />
      </div>
    </div>
  );
}
