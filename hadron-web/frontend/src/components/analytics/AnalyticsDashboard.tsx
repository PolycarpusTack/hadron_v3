import { useEffect, useState } from "react";
import { api, AnalyticsDashboard as DashboardData } from "../../services/api";
import { useToast } from "../Toast";
import { SimpleBarChart } from "./SimpleBarChart";
import { SimpleTrendChart } from "./SimpleTrendChart";

export function AnalyticsDashboard() {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api
      .getAnalytics(days)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [days, toast]);

  if (loading) {
    return <div className="py-12 text-center text-slate-400">Loading analytics...</div>;
  }

  if (!data) {
    return <div className="py-12 text-center text-slate-400">No data available</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Analytics</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200 focus:outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Analyses" value={data.totalAnalyses} />
        <StatCard label="This Week" value={data.thisWeek} />
        <StatCard label="This Month" value={data.thisMonth} />
      </div>

      {/* Trend chart */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">
          Daily Trend
        </h3>
        <SimpleTrendChart data={data.dailyTrend} height={200} />
      </div>

      {/* Distribution charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-300">
            Severity Distribution
          </h3>
          <SimpleBarChart
            data={data.severityDistribution}
            height={180}
            color="#ef4444"
          />
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-300">
            Top Components
          </h3>
          <SimpleBarChart
            data={data.componentDistribution}
            height={180}
            color="#3b82f6"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">
          Top Error Types
        </h3>
        <SimpleBarChart
          data={data.errorTypeTop}
          height={180}
          color="#a855f7"
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-bold text-white">{value}</dd>
    </div>
  );
}
