import { PerfRecommendation } from '../../services/api';
import { getSeverityColor, getRecTypeIcon } from './performanceHelpers';

interface Props {
  recommendations: PerfRecommendation[];
}

export function PerformanceRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return <p className="text-slate-500 text-sm">No recommendations available.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((rec, i) => (
        <div
          key={i}
          className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-4"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5" role="img" aria-label={rec.recType}>
              {getRecTypeIcon(rec.recType)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-slate-200 font-medium">{rec.title}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${getSeverityColor(rec.priority)}`}>
                  {rec.priority}
                </span>
                {rec.effort && (
                  <span className="text-xs bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded">
                    effort: {rec.effort}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">{rec.description}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
