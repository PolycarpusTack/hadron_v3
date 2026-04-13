import { ProcessInfo } from '../../services/api';
import { getMethodBarColor } from './performanceHelpers';

interface Props {
  processes: ProcessInfo[];
}

export function PerformanceProcesses({ processes }: Props) {
  if (processes.length === 0) {
    return <p className="text-slate-500 text-sm">No process data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left">
            <th className="pb-2 pr-4 text-slate-400 font-medium">Process Name</th>
            <th className="pb-2 pr-4 text-slate-400 font-medium">Distribution</th>
            <th className="pb-2 pr-4 text-slate-400 font-medium text-right">%</th>
            <th className="pb-2 text-slate-400 font-medium">Priority</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((proc, i) => (
            <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
              <td className="py-2 pr-4 text-slate-200 font-medium">
                <div className="flex items-center gap-2">
                  {proc.name}
                  {proc.status === 'warning' && (
                    <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                      warning
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-4 w-40">
                <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getMethodBarColor(proc.percentage)}`}
                    style={{ width: `${Math.min(proc.percentage, 100)}%` }}
                  />
                </div>
              </td>
              <td className="py-2 pr-4 text-slate-300 text-right tabular-nums">
                {proc.percentage.toFixed(1)}%
              </td>
              <td className="py-2 text-slate-400 text-xs">@{proc.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
