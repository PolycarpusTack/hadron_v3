import { UserScenario } from '../../services/api';

interface Props {
  scenario: UserScenario;
}

export function PerformanceScenario({ scenario }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {/* Trigger + Impact side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Trigger</p>
          <p className="text-slate-200 text-sm leading-relaxed">{scenario.trigger || '—'}</p>
        </div>
        <div className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Impact</p>
          <p className="text-slate-200 text-sm leading-relaxed">
            {scenario.action || '—'}
            {scenario.impactPercentage > 0 && (
              <span className="ml-2 text-xs text-amber-400 font-medium">
                ({scenario.impactPercentage.toFixed(1)}% of trace)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* What Happened narrative */}
      {scenario.action && (
        <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-4">
          <p className="text-xs text-teal-400 uppercase tracking-wide font-medium mb-2">What Happened</p>
          <p className="text-slate-300 text-sm leading-relaxed">{scenario.action}</p>
        </div>
      )}

      {/* Context */}
      {scenario.context && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Context</p>
          <p className="text-slate-400 text-sm leading-relaxed">{scenario.context}</p>
        </div>
      )}

      {/* Contributing Factors */}
      {scenario.contributingFactors && scenario.contributingFactors.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">Contributing Factors</p>
          <ul className="flex flex-col gap-1">
            {scenario.contributingFactors.map((factor, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-teal-500 mt-0.5 shrink-0">&#8226;</span>
                {factor}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
