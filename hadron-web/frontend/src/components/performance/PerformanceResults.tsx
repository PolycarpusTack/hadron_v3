import { useState } from 'react';
import { PerformanceTraceResult } from '../../services/api';
import { getSeverityColor } from './performanceHelpers';
import { PerformanceHeaderStats } from './PerformanceHeaderStats';
import { PerformanceProcesses } from './PerformanceProcesses';
import { PerformanceTopMethods } from './PerformanceTopMethods';
import { PerformancePatterns } from './PerformancePatterns';
import { PerformanceScenario } from './PerformanceScenario';
import { PerformanceRecommendations } from './PerformanceRecommendations';

interface SectionProps {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, badge, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700 rounded-lg mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between text-left bg-slate-800/60 hover:bg-slate-700/40 transition-colors rounded-lg"
      >
        <span className="font-medium text-slate-200">{title}</span>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
          <span className="text-slate-400 text-xs">{open ? '\u25B2' : '\u25BC'}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-2">{children}</div>}
    </div>
  );
}

interface Props {
  result: PerformanceTraceResult;
}

export function PerformanceResults({ result }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {/* Section 1: Summary */}
      <Section title="Summary">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-sm px-2.5 py-1 rounded font-semibold ${getSeverityColor(result.overallSeverity)}`}>
              {result.overallSeverity.toUpperCase()}
            </span>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              {result.filename && <span>&#128196; {result.filename}</span>}
              {result.user && <span>&#128100; {result.user}</span>}
              {result.timestamp && <span>&#128337; {result.timestamp}</span>}
            </div>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">{result.summary}</p>
        </div>
      </Section>

      {/* Section 2: Header Statistics */}
      <Section title="Header Statistics">
        <PerformanceHeaderStats header={result.header} derived={result.derived} />
      </Section>

      {/* Section 3: Process Distribution */}
      <Section title="Process Distribution" badge={`${result.processes.length} processes`}>
        <PerformanceProcesses processes={result.processes} />
      </Section>

      {/* Section 4: Top Methods */}
      <Section title="Top Methods" badge={`${result.topMethods.length} methods`}>
        <PerformanceTopMethods methods={result.topMethods} />
      </Section>

      {/* Section 5: Detected Patterns */}
      <Section title="Detected Patterns" badge={`${result.patterns.length} patterns`}>
        <PerformancePatterns patterns={result.patterns} />
      </Section>

      {/* Section 6: Scenario */}
      <Section title="Scenario">
        <PerformanceScenario scenario={result.scenario} />
      </Section>

      {/* Section 7: Recommendations */}
      <Section title="Recommendations" badge={`${result.recommendations.length} items`}>
        <PerformanceRecommendations recommendations={result.recommendations} />
      </Section>
    </div>
  );
}
