import { PerformanceHeader, PerfDerivedMetrics } from '../../services/api';
import { formatSeconds } from './performanceHelpers';

interface Props {
  header: PerformanceHeader;
  derived: PerfDerivedMetrics;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-700/50 rounded-lg p-3 flex flex-col gap-0.5">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className="text-xl font-semibold text-slate-100">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

function SmallCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-700/30 rounded px-3 py-2 flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-300">{value}</span>
    </div>
  );
}

export function PerformanceHeaderStats({ header, derived }: Props) {
  const gcEvents = header.scavenges + header.incGcs;

  return (
    <div className="flex flex-col gap-4">
      {/* Primary 2x2 grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Samples" value={header.samples.toLocaleString()} sub={`${header.avgMsPerSample.toFixed(1)} ms/sample`} />
        <MetricCard label="Real Time" value={formatSeconds(header.realTime)} sub="wall-clock" />
        <MetricCard label="Active Time" value={formatSeconds(header.activeTime)} sub={`${((header.activeTime / header.realTime) * 100).toFixed(0)}% of real`} />
        <MetricCard label="GC Events" value={gcEvents.toLocaleString()} sub={`${header.scavenges} scavenges / ${header.incGcs} inc`} />
      </div>

      {/* Secondary smaller cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SmallCard label="Stack Spills" value={header.stackSpills.toLocaleString()} />
        <SmallCard label="Mark Stack Overflows" value={header.markStackOverflows.toLocaleString()} />
        <SmallCard label="Weak List Overflows" value={header.weakListOverflows.toLocaleString()} />
        <SmallCard label="JIT Cache Spills" value={header.jitCacheSpills.toLocaleString()} />
      </div>

      {/* Derived metrics panel */}
      <div className="border border-teal-700/50 bg-teal-900/20 rounded-lg p-3">
        <p className="text-xs text-teal-400 font-medium uppercase tracking-wide mb-2">Derived Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-slate-500">CPU Utilization</p>
            <p className="text-sm font-semibold text-slate-200">{derived.cpuUtilization.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Activity Ratio</p>
            <p className="text-sm font-semibold text-slate-200">{derived.activityRatio.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Sample Density</p>
            <p className="text-sm font-semibold text-slate-200">{derived.sampleDensity.toFixed(2)}/s</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">GC Pressure</p>
            <p className="text-sm font-semibold text-slate-200">{derived.gcPressure.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
