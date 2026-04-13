import { PerfDetectedPattern } from '../../services/api';
import { getSeverityColor } from './performanceHelpers';

interface Props {
  patterns: PerfDetectedPattern[];
}

export function PerformancePatterns({ patterns }: Props) {
  if (patterns.length === 0) {
    return <p className="text-slate-500 text-sm">No patterns detected.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {patterns.map((p, i) => (
        <div
          key={i}
          className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${getSeverityColor(p.severity)}`}>
                {p.severity}
              </span>
              <span className="text-slate-200 font-medium">{p.title}</span>
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">
              {(p.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">{p.description}</p>
          {p.patternType && (
            <p className="text-xs text-slate-500 mt-1">Type: {p.patternType}</p>
          )}
        </div>
      ))}
    </div>
  );
}
