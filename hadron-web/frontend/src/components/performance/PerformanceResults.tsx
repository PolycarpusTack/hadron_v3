import { useState } from 'react';
import { PerformanceTraceResult, ExportSection } from '../../services/api';
import { ExportDialog } from '../export/ExportDialog';
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

function buildExportSections(result: PerformanceTraceResult): ExportSection[] {
  return [
    {
      id: 'summary',
      label: 'Summary',
      content: `Severity: ${result.overallSeverity}\n${result.summary}`,
    },
    {
      id: 'stats',
      label: 'Statistics',
      content: `CPU: ${result.derived.cpuUtilization}%\nActivity: ${result.derived.activityRatio}%\nGC Pressure: ${result.derived.gcPressure}\nSamples: ${result.header.samples}`,
    },
    {
      id: 'processes',
      label: 'Processes',
      content: result.processes.map(p => `${p.name} @ ${p.priority}: ${p.percentage}%`).join('\n'),
    },
    {
      id: 'methods',
      label: 'Top Methods',
      content: result.topMethods.map(m => `${m.percentage}% ${m.method} (${m.category})`).join('\n'),
    },
    {
      id: 'patterns',
      label: 'Patterns',
      content: result.patterns.length
        ? result.patterns.map(p => `[${p.severity}] ${p.title} (${p.confidence}%)\n${p.description}`).join('\n\n')
        : 'No patterns',
    },
    {
      id: 'scenario',
      label: 'Scenario',
      content: `Trigger: ${result.scenario.trigger}\n${result.scenario.action}\n\nContext: ${result.scenario.context}\n\nFactors:\n${result.scenario.contributingFactors.map(f => `- ${f}`).join('\n')}`,
    },
    {
      id: 'recommendations',
      label: 'Recommendations',
      content: result.recommendations.map(r => `[${r.priority}] ${r.title}\n${r.description}`).join('\n\n'),
    },
  ];
}

interface Props {
  result: PerformanceTraceResult;
}

export function PerformanceResults({ result }: Props) {
  const [showExport, setShowExport] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex justify-end mb-1">
        <button
          onClick={() => setShowExport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 border border-slate-600 rounded-md hover:bg-slate-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Export
        </button>
      </div>

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

      {showExport && (
        <ExportDialog
          onClose={() => setShowExport(false)}
          title={result.filename || 'Performance Analysis'}
          sourceType="performance"
          sections={buildExportSections(result)}
        />
      )}
    </div>
  );
}
