import { TopMethod } from '../../services/api';
import { getCategoryColor, getMethodBarColor } from './performanceHelpers';

interface Props {
  methods: TopMethod[];
}

export function PerformanceTopMethods({ methods }: Props) {
  if (methods.length === 0) {
    return <p className="text-slate-500 text-sm">No method data available.</p>;
  }

  const maxPct = Math.max(...methods.map((m) => m.percentage), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left">
            <th className="pb-2 pr-4 text-slate-400 font-medium">Method</th>
            <th className="pb-2 pr-4 text-slate-400 font-medium">Category</th>
            <th className="pb-2 pr-4 text-slate-400 font-medium text-right">%</th>
            <th className="pb-2 text-slate-400 font-medium w-36">Bar</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m, i) => (
            <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
              <td className="py-2 pr-4 text-slate-200 font-mono text-xs max-w-xs truncate" title={m.method}>
                {m.method}
              </td>
              <td className="py-2 pr-4">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getCategoryColor(m.category)}`}>
                  {m.category}
                </span>
              </td>
              <td className="py-2 pr-4 text-slate-300 text-right tabular-nums">
                {m.percentage.toFixed(1)}%
              </td>
              <td className="py-2">
                <div className="h-2 bg-slate-600 rounded-full overflow-hidden w-36">
                  <div
                    className={`h-full rounded-full ${getMethodBarColor(m.percentage)}`}
                    style={{ width: `${(m.percentage / maxPct) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
