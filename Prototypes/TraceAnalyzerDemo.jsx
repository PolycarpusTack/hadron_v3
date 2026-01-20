import React, { useState, useCallback } from 'react';
import { Upload, FileText, AlertTriangle, CheckCircle, Clock, Database, Monitor, Cpu, ChevronDown, ChevronRight, Zap, Users, MousePointer, TrendingUp, AlertCircle, Info, Download, Trash2, Play, BarChart3, GitBranch, List, Target, Lightbulb, RefreshCw } from 'lucide-react';

const mockAnalysisResults = {
  'performanceTrace_marcello_venditti_2025-12-10_15-52-46.log': {
    filename: 'performanceTrace_marcello_venditti_2025-12-10_15-52-46.log',
    user: 'Marcello Venditti',
    timestamp: '2025-12-10 15:52:46',
    header: { samples: 3329, avgMsPerSample: 90.2, scavenges: 3842, incGCs: 34, stackSpills: 3899, markStackOverflows: 0, weakListOverflows: 0, jitCacheSpills: 238, activeTime: 84.25, otherProcesses: 215.29, realTime: 300.27, profilingOverhead: 0.72 },
    derived: { cpuUtilization: 99.8, smalltalkActivityRatio: 28.1, sampleDensity: 11.1, gcPressure: 1.16 },
    processes: [
      { name: 'Mediagenix Launcher', priority: 50, percentage: 85.3, status: 'normal' },
      { name: 'IdleLoopProcess', priority: 10, percentage: 6.0, status: 'normal' },
      { name: 'FinalizationProcess', priority: 98, percentage: 2.1, status: 'normal' },
      { name: 'primitives', priority: '-', percentage: 2.8, status: 'normal' }
    ],
    topMethods: [
      { method: 'ExternalMethod class>>primCallC:...', percentage: 12.6, category: 'FFI/External' },
      { method: 'GraphicsContext>>paint:', percentage: 7.7, category: 'Graphics' },
      { method: 'ObjectMemory>>primMeasureIGC...', percentage: 5.9, category: 'GC' },
      { method: 'PostgresInterface>>PQexecPrepared:...', percentage: 5.2, category: 'Database' },
      { method: 'MAFColumnDefinition>>display...', percentage: 3.0, category: 'UI Rendering' }
    ],
    patterns: [
      { type: 'ui_rendering', severity: 'medium', title: 'UI Rendering Overhead', description: 'Significant time in graphics operations (12.6% FFI + 7.7% paint)', confidence: 85 },
      { type: 'user_interaction', severity: 'info', title: 'Right-Click List Selection', description: 'YellowButtonPressedEvent - user performed right-click selection (27% active time)', confidence: 95 }
    ],
    scenario: { trigger: 'Right-click in list widget', action: 'User performed right-click selection in MAF2List component', context: 'Selection triggered event grabbing for drag operation', impact: '27% of CPU time during trace', additionalFactors: ['Complex widget hierarchy', 'Multiple column definitions'] },
    recommendations: [
      { type: 'optimization', priority: 'medium', title: 'Review List Rendering', description: 'Consider virtual scrolling for large lists', effort: 'Medium' },
      { type: 'workaround', priority: 'low', title: 'Reduce Visible Columns', description: 'Hide non-essential columns to reduce overhead', effort: 'None' }
    ],
    overallSeverity: 'medium',
    summary: 'Moderate UI rendering overhead during list interaction with optimization opportunities.'
  },
  'performanceTrace_stefano_saggioro_2025-12-05_12-16-12.log': {
    filename: 'performanceTrace_stefano_saggioro_2025-12-05_12-16-12.log',
    user: 'Stefano Saggioro',
    timestamp: '2025-12-05 12:16:12',
    header: { samples: 6754, avgMsPerSample: 44.43, scavenges: 5784, incGCs: 37, stackSpills: 4271, markStackOverflows: 0, weakListOverflows: 0, jitCacheSpills: 290, activeTime: 121.45, otherProcesses: 177.41, realTime: 300.11, profilingOverhead: 1.26 },
    derived: { cpuUtilization: 99.6, smalltalkActivityRatio: 40.6, sampleDensity: 22.5, gcPressure: 0.86 },
    processes: [
      { name: 'Mediagenix Launcher', priority: 50, percentage: 83.4, status: 'normal' },
      { name: 'IdleLoopProcess', priority: 10, percentage: 9.8, status: 'warning' },
      { name: 'FinalizationProcess', priority: 98, percentage: 3.2, status: 'normal' },
      { name: 'ScavengeProcess', priority: 90, percentage: 1.8, status: 'normal' }
    ],
    topMethods: [
      { method: 'ObjectMemory>>primMeasureIGC...', percentage: 9.9, category: 'GC' },
      { method: 'ExternalMethod class>>primCallC:...', percentage: 7.1, category: 'FFI/External' },
      { method: 'GraphicsContext>>paint:', percentage: 3.6, category: 'Graphics' },
      { method: 'WeakArray>>queueOverflowSignal', percentage: 3.2, category: 'GC' },
      { method: 'PostgresInterface>>PQexecPrepared:...', percentage: 1.1, category: 'Database' }
    ],
    patterns: [
      { type: 'changelog_sync', severity: 'high', title: 'Heavy Change Log Sync', description: 'T3ChangeLogSynchronizer at 34.9% - other user changes being synced', confidence: 95 },
      { type: 'gc_pressure', severity: 'medium', title: 'Elevated GC Activity', description: 'IdleLoopProcess at 9.8%, GC methods totaling 14.8%', confidence: 88 },
      { type: 'widget_update', severity: 'medium', title: 'Cascading Widget Updates', description: 'updateWidgetsInApplications at 27.7% - all windows refreshing', confidence: 92 }
    ],
    scenario: { trigger: 'Change Log Polling (automatic)', action: 'Background sync detected changes from other users', context: 'System processed change batch and updated all open windows', impact: 'Sync 35% + widget updates 28% = 63% CPU', additionalFactors: ['Multiple windows open', 'Large change batch', 'Complex UI refresh'] },
    recommendations: [
      { type: 'documentation', priority: 'high', title: 'Expected Multi-User Behavior', description: 'Normal when other users commit changes. Document for awareness.', effort: 'None' },
      { type: 'workaround', priority: 'medium', title: 'Close Unused Windows', description: 'Reduce windows to minimize sync overhead', effort: 'None' },
      { type: 'configuration', priority: 'medium', title: 'Review Polling Interval', description: 'Adjust change log polling frequency', effort: 'Low' }
    ],
    overallSeverity: 'high',
    summary: 'Heavy multi-user synchronization caused cascading UI updates across all open windows.'
  }
};

const SeverityBadge = ({ severity }) => {
  const config = {
    critical: 'bg-red-100 text-red-800 border-red-300',
    high: 'bg-orange-100 text-orange-800 border-orange-300',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    low: 'bg-blue-100 text-blue-800 border-blue-300',
    info: 'bg-gray-100 text-gray-700 border-gray-300',
    normal: 'bg-green-100 text-green-800 border-green-300',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-300'
  };
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${config[severity] || config.info}`}>{severity.toUpperCase()}</span>;
};

const CategoryBadge = ({ category }) => {
  const colors = {
    'FFI/External': 'bg-purple-100 text-purple-800',
    'Graphics': 'bg-pink-100 text-pink-800',
    'GC': 'bg-orange-100 text-orange-800',
    'Database': 'bg-blue-100 text-blue-800',
    'UI Rendering': 'bg-indigo-100 text-indigo-800'
  };
  return <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[category] || 'bg-gray-100 text-gray-800'}`}>{category}</span>;
};

const MetricCard = ({ icon: Icon, label, value, unit, status, subtext }) => (
  <div className={`bg-white rounded-lg border p-3 ${status === 'warning' ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'}`}>
    <div className="flex items-center gap-2 text-gray-500 mb-1">
      <Icon size={14} />
      <span className="text-xs font-medium uppercase">{label}</span>
    </div>
    <div className="flex items-baseline gap-1">
      <span className="text-xl font-bold text-gray-900">{value}</span>
      {unit && <span className="text-sm text-gray-500">{unit}</span>}
    </div>
    {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
  </div>
);

const ProgressBar = ({ value, max = 100, color = 'blue' }) => {
  const colors = { blue: 'bg-blue-500', green: 'bg-green-500', yellow: 'bg-yellow-500', orange: 'bg-orange-500', red: 'bg-red-500' };
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`${colors[color]} h-2 rounded-full transition-all`} style={{ width: `${Math.min((value / max) * 100, 100)}%` }} />
    </div>
  );
};

const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = true, badge }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100">
        <div className="flex items-center gap-3">
          <Icon size={18} className="text-gray-600" />
          <span className="font-semibold text-gray-800">{title}</span>
          {badge}
        </div>
        {isOpen ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>
      {isOpen && <div className="p-4 border-t border-gray-200">{children}</div>}
    </div>
  );
};

const AnalysisResult = ({ result }) => {
  const getColor = (pct) => pct >= 20 ? 'red' : pct >= 10 ? 'orange' : pct >= 5 ? 'yellow' : 'blue';
  
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">{result.filename}</h2>
            <p className="text-slate-300 text-sm">User: {result.user} • {result.timestamp}</p>
          </div>
          <SeverityBadge severity={result.overallSeverity} />
        </div>
        <p className="mt-3 text-slate-200 text-sm">{result.summary}</p>
      </div>

      <CollapsibleSection title="Header Statistics" icon={BarChart3}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard icon={Cpu} label="Samples" value={result.header.samples.toLocaleString()} subtext={`${result.header.avgMsPerSample.toFixed(1)} ms avg`} />
          <MetricCard icon={Clock} label="Real Time" value={result.header.realTime.toFixed(1)} unit="s" />
          <MetricCard icon={Zap} label="Active" value={result.header.activeTime.toFixed(1)} unit="s" subtext={`${result.derived.smalltalkActivityRatio.toFixed(1)}%`} />
          <MetricCard icon={RefreshCw} label="GC Events" value={result.header.scavenges + result.header.incGCs} status={result.header.scavenges > 5000 ? 'warning' : 'normal'} />
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[['Stack Spills', result.header.stackSpills], ['Mark Overflows', result.header.markStackOverflows], ['Weak Overflows', result.header.weakListOverflows], ['JIT Spills', result.header.jitCacheSpills]].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded p-2">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`font-semibold ${val > 0 && label.includes('Overflow') ? 'text-red-600' : ''}`}>{val.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Process Distribution" icon={GitBranch}>
        <div className="space-y-2">
          {result.processes.map((p, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-36 text-sm font-medium text-gray-800 truncate">{p.name}</div>
              {p.status !== 'normal' && <SeverityBadge severity={p.status} />}
              <div className="flex-1"><ProgressBar value={p.percentage} color={p.percentage > 15 && p.name !== 'Mediagenix Launcher' ? 'orange' : 'blue'} /></div>
              <div className="w-16 text-right font-mono text-sm">{p.percentage.toFixed(1)}%</div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Top Methods" icon={List}>
        <div className="space-y-2">
          {result.topMethods.map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-gray-100">
              <code className="flex-1 text-xs text-gray-700 truncate">{m.method}</code>
              <CategoryBadge category={m.category} />
              <span className="w-14 text-right font-medium text-sm">{m.percentage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Detected Patterns" icon={Target} badge={<span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">{result.patterns.length}</span>}>
        <div className="space-y-3">
          {result.patterns.map((p, i) => (
            <div key={i} className={`p-3 rounded-lg border ${p.severity === 'high' ? 'bg-orange-50 border-orange-200' : p.severity === 'medium' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {p.severity === 'high' && <AlertTriangle size={16} className="text-orange-600" />}
                  {p.severity === 'medium' && <AlertCircle size={16} className="text-yellow-600" />}
                  {p.severity === 'info' && <Info size={16} className="text-gray-600" />}
                  <span className="font-semibold text-gray-800">{p.title}</span>
                </div>
                <SeverityBadge severity={p.severity} />
              </div>
              <p className="text-sm text-gray-700">{p.description}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="User Scenario" icon={MousePointer}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded p-3">
              <p className="text-xs text-gray-500 uppercase mb-1">Trigger</p>
              <p className="font-medium">{result.scenario.trigger}</p>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <p className="text-xs text-gray-500 uppercase mb-1">Impact</p>
              <p className="font-medium">{result.scenario.impact}</p>
            </div>
          </div>
          <div className="bg-blue-50 rounded p-3 border border-blue-200">
            <p className="text-sm text-gray-800">{result.scenario.action}</p>
            <p className="text-xs text-gray-600 mt-1">{result.scenario.context}</p>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Recommendations" icon={Lightbulb}>
        <div className="space-y-2">
          {result.recommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <div className={`p-1.5 rounded ${r.type === 'optimization' ? 'bg-purple-100' : r.type === 'workaround' ? 'bg-green-100' : 'bg-blue-100'}`}>
                {r.type === 'optimization' && <TrendingUp size={16} className="text-purple-600" />}
                {r.type === 'workaround' && <CheckCircle size={16} className="text-green-600" />}
                {r.type === 'documentation' && <FileText size={16} className="text-blue-600" />}
                {r.type === 'configuration' && <RefreshCw size={16} className="text-orange-600" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-800">{r.title}</span>
                  <SeverityBadge severity={r.priority} />
                </div>
                <p className="text-sm text-gray-600">{r.description}</p>
                <p className="text-xs text-gray-400 mt-1">Effort: {r.effort}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default function PerformanceTraceAnalyzer() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState(0);

  const demoFiles = [
    { name: 'performanceTrace_marcello_venditti_2025-12-10_15-52-46.log', size: 1025024 },
    { name: 'performanceTrace_stefano_saggioro_2025-12-05_12-16-12.log', size: 650240 }
  ];

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setResults([]);
    for (let i = 0; i < files.length; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const mock = mockAnalysisResults[files[i].name] || { ...Object.values(mockAnalysisResults)[0], filename: files[i].name };
      setResults(prev => [...prev, mock]);
    }
    setIsAnalyzing(false);
  };

  const loadDemo = () => { setFiles(demoFiles); setResults([]); };
  const reset = () => { setFiles([]); setResults([]); setActiveTab(0); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg"><Cpu size={20} className="text-white" /></div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Performance Trace Analyzer</h1>
              <p className="text-xs text-gray-500">VisualWorks / MediaGenix WHATS'ON</p>
            </div>
          </div>
          <div className="flex gap-2">
            {files.length === 0 && <button onClick={loadDemo} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Load Demo</button>}
            {results.length > 0 && <button onClick={reset} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><RefreshCw size={14} />New</button>}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {results.length === 0 ? (
          <div className="max-w-xl mx-auto space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 mb-2">Upload Performance Traces</h2>
              <p className="text-gray-600 text-sm">Upload .log files to analyze CPU profiles and get actionable insights</p>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center bg-gray-50 hover:border-gray-400">
              <Upload size={40} className="mx-auto mb-3 text-gray-400" />
              <p className="text-gray-700 font-medium mb-1">Drop trace files here</p>
              <p className="text-sm text-gray-500 mb-4">Supports batch upload • .log files</p>
              <button onClick={loadDemo} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                Try Demo Files
              </button>
            </div>

            {files.length > 0 && (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">{files.length} file(s) ready:</p>
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between bg-white border rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileText size={18} className="text-blue-500" />
                        <span className="text-sm font-medium">{f.name}</span>
                        <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                      </div>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 font-medium">
                  {isAnalyzing ? <><RefreshCw size={18} className="animate-spin" />Analyzing...</> : <><Play size={18} />Analyze {files.length} File{files.length > 1 ? 's' : ''}</>}
                </button>
              </>
            )}

            {isAnalyzing && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                <RefreshCw className="text-blue-600 animate-spin" size={20} />
                <div>
                  <p className="font-medium text-blue-900">Analyzing {results.length + 1} of {files.length}...</p>
                  <p className="text-sm text-blue-700">Parsing, detecting patterns, generating recommendations</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mt-8">
              {[
                [BarChart3, 'blue', 'Metrics', 'Full statistical breakdown'],
                [Target, 'purple', 'Patterns', 'Auto-detect issues'],
                [Lightbulb, 'green', 'Insights', 'Actionable recommendations']
              ].map(([Icon, color, title, desc]) => (
                <div key={title} className="bg-white rounded-lg p-4 border">
                  <Icon size={20} className={`text-${color}-600 mb-2`} />
                  <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {results.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {results.map((r, i) => (
                  <button key={i} onClick={() => setActiveTab(i)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap ${activeTab === i ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border hover:bg-gray-50'}`}>
                    <FileText size={14} />
                    {r.user}
                    <SeverityBadge severity={r.overallSeverity} />
                  </button>
                ))}
              </div>
            )}
            <AnalysisResult result={results[activeTab]} />
            <div className="flex justify-end gap-2 pt-4 border-t">
              <button className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"><Download size={16} />Export PDF</button>
              <button className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"><Download size={16} />Export JSON</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
