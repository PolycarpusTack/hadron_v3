import { useState, useCallback } from 'react';
import {
  Upload, FileText, AlertTriangle, CheckCircle, Clock,
  Cpu, ChevronDown, ChevronRight, Zap, MousePointer,
  TrendingUp, AlertCircle, Info, Download, Trash2, Play,
  BarChart3, GitBranch, List, Target, Lightbulb, RefreshCw,
  Loader2
} from 'lucide-react';
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import logger from "../services/logger";
import AnalyzerEntryPanel from "./AnalyzerEntryPanel";
import Button from "./ui/Button";

// Types for performance trace analysis (snake_case to match Rust backend)
interface PerformanceHeader {
  samples: number;
  avg_ms_per_sample: number;
  scavenges: number;
  inc_gcs: number;
  stack_spills: number;
  mark_stack_overflows: number;
  weak_list_overflows: number;
  jit_cache_spills: number;
  active_time: number;
  other_processes: number;
  real_time: number;
  profiling_overhead: number;
}

interface DerivedMetrics {
  cpu_utilization: number;
  smalltalk_activity_ratio: number;
  sample_density: number;
  gc_pressure: number;
}

interface ProcessInfo {
  name: string;
  priority: number | string;
  percentage: number;
  status: 'normal' | 'warning' | 'error';
}

interface TopMethod {
  method: string;
  percentage: number;
  category: string;
}

interface DetectedPattern {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  confidence: number;
}

interface UserScenario {
  trigger: string;
  action: string;
  context: string;
  impact: string;
  additional_factors: string[];
}

interface Recommendation {
  type: 'optimization' | 'workaround' | 'investigation' | 'configuration' | 'documentation';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  effort: string;
}

interface PerformanceAnalysisResult {
  filename: string;
  user: string;
  timestamp: string;
  header: PerformanceHeader;
  derived: DerivedMetrics;
  processes: ProcessInfo[];
  top_methods: TopMethod[];
  patterns: DetectedPattern[];
  scenario: UserScenario;
  recommendations: Recommendation[];
  overall_severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  summary: string;
}

interface FileInfo {
  path: string;
  name: string;
  size: number;
}

// Severity badge component
function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { bg: string; text: string; border: string }> = {
    critical: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/50' },
    high: { bg: 'bg-orange-900/30', text: 'text-orange-400', border: 'border-orange-500/50' },
    medium: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-500/50' },
    low: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-500/50' },
    info: { bg: 'bg-gray-700/30', text: 'text-gray-400', border: 'border-gray-500/50' },
    normal: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/50' },
    warning: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-500/50' }
  };
  const c = config[severity] || config.info;
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${c.bg} ${c.text} border ${c.border}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// Category badge component
function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    'FFI/External': 'bg-purple-900/30 text-purple-400',
    'Graphics': 'bg-pink-900/30 text-pink-400',
    'GC': 'bg-orange-900/30 text-orange-400',
    'Database': 'bg-blue-900/30 text-blue-400',
    'UI Rendering': 'bg-indigo-900/30 text-indigo-400',
    'Collection': 'bg-green-900/30 text-green-400',
    'Session': 'bg-cyan-900/30 text-cyan-400'
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[category] || 'bg-gray-700/30 text-gray-400'}`}>
      {category}
    </span>
  );
}

// Metric card component
function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  status,
  subtext
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  status?: 'normal' | 'warning' | 'error';
  subtext?: string;
}) {
  return (
    <div className={`bg-gray-800/50 rounded-lg border p-4 ${
      status === 'warning' ? 'border-yellow-500/50 bg-yellow-900/10' :
      status === 'error' ? 'border-red-500/50 bg-red-900/10' :
      'border-gray-700'
    }`}>
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white">{value}</span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
      </div>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  );
}

// Progress bar component
function ProgressBar({
  value,
  max = 100,
  color = 'blue',
  height = 'h-2'
}: {
  value: number;
  max?: number;
  color?: string;
  height?: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const colors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500'
  };
  return (
    <div className={`w-full bg-gray-700 rounded-full ${height}`}>
      <div
        className={`${colors[color]} ${height} rounded-full transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  badge
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-800/80 hover:bg-gray-700/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon size={20} className="text-gray-400" />
          <span className="font-semibold text-white">{title}</span>
          {badge}
        </div>
        {isOpen ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
      </button>
      {isOpen && <div className="p-4 border-t border-gray-700">{children}</div>}
    </div>
  );
}

// File upload component
function FileUpload({
  onFilesSelected,
  files,
  onRemoveFile,
  isAnalyzing
}: {
  onFilesSelected: (files: FileInfo[]) => void;
  files: FileInfo[];
  onRemoveFile: (index: number) => void;
  isAnalyzing: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // Show message to use file picker instead (Tauri limitation)
    alert("Please use the file picker button below instead of drag & drop.\n\nThis ensures proper file path handling in Tauri.");
  }, []);

  const handleSelectFile = async () => {
    if (isAnalyzing) return;

    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Performance Traces",
            extensions: ["log", "txt"],
          },
        ],
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      // Get file info for each path
      const fileInfos: FileInfo[] = await Promise.all(
        paths.map(async (path) => {
          const name = path.split(/[/\\]/).pop() || path;
          // Try to get file size from Tauri
          let size = 0;
          try {
            const stats = await invoke<{ size: number }>("get_file_stats", { path });
            size = stats.size;
          } catch {
            // Ignore if we can't get stats
          }
          return { path, name, size };
        })
      );

      onFilesSelected(fileInfos);
    } catch (error) {
      logger.error('File selection failed', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to select file. Please try again.");
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10 scale-105'
            : 'border-gray-600 hover:border-gray-500'
        } ${isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <Upload size={48} className={`mx-auto mb-4 ${isDragging ? 'text-blue-400' : 'text-gray-400'}`} />
        <p className="text-xl font-semibold text-white mb-2">
          Select one or more performance trace files
        </p>
        <p className="text-sm text-gray-400 mb-6">
          Click the button below to browse
        </p>
        <Button
          onClick={handleSelectFile}
          disabled={isAnalyzing}
          variant="primary"
          size="lg"
          icon={<FileText size={18} />}
          className="font-semibold"
        >
          Choose File
        </Button>
        <p className="text-gray-500 text-sm mt-4">
          Supports .log and .txt files - batch upload supported
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-300">{files.length} file(s) selected:</p>
          {files.map((file, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-blue-400" />
                <div>
                  <p className="font-medium text-white">{file.name}</p>
                  {file.size > 0 && (
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => onRemoveFile(index)}
                disabled={isAnalyzing}
                className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Analysis result component
function AnalysisResultView({ result }: { result: PerformanceAnalysisResult }) {
  const getColorForPercentage = (pct: number) => {
    if (pct >= 20) return 'red';
    if (pct >= 10) return 'orange';
    if (pct >= 5) return 'yellow';
    return 'blue';
  };

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl p-6 text-white border border-gray-600">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold mb-1">{result.filename}</h2>
            <p className="text-slate-300 text-sm">User: {result.user} - {result.timestamp}</p>
          </div>
          <SeverityBadge severity={result.overall_severity} />
        </div>
        <p className="mt-4 text-slate-200">{result.summary}</p>
      </div>

      {/* Header Statistics */}
      <CollapsibleSection title="Header Statistics" icon={BarChart3}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard icon={Cpu} label="Samples" value={result.header.samples.toLocaleString()} subtext={`${result.header.avg_ms_per_sample.toFixed(1)} ms/sample avg`} />
          <MetricCard icon={Clock} label="Real Time" value={result.header.real_time.toFixed(1)} unit="sec" subtext="Profiling duration" />
          <MetricCard icon={Zap} label="Active Time" value={result.header.active_time.toFixed(1)} unit="sec" subtext={`${result.derived.smalltalk_activity_ratio.toFixed(1)}% of total`} />
          <MetricCard icon={RefreshCw} label="GC Events" value={result.header.scavenges + result.header.inc_gcs} subtext={`${result.header.scavenges} scavenges, ${result.header.inc_gcs} incGCs`} status={result.header.scavenges > 5000 ? 'warning' : 'normal'} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-700/30 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Stack Spills</p>
            <p className="text-lg font-semibold text-white">{result.header.stack_spills.toLocaleString()}</p>
          </div>
          <div className="bg-gray-700/30 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Mark Stack Overflows</p>
            <p className={`text-lg font-semibold ${result.header.mark_stack_overflows > 0 ? 'text-red-400' : 'text-white'}`}>{result.header.mark_stack_overflows}</p>
          </div>
          <div className="bg-gray-700/30 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Weak List Overflows</p>
            <p className={`text-lg font-semibold ${result.header.weak_list_overflows > 0 ? 'text-red-400' : 'text-white'}`}>{result.header.weak_list_overflows}</p>
          </div>
          <div className="bg-gray-700/30 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">JIT Cache Spills</p>
            <p className="text-lg font-semibold text-white">{result.header.jit_cache_spills}</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
          <h4 className="font-medium text-blue-400 mb-3">Derived Metrics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-blue-300/70">CPU Utilization</p>
              <p className="font-bold text-blue-300">{result.derived.cpu_utilization.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-blue-300/70">Smalltalk Activity</p>
              <p className="font-bold text-blue-300">{result.derived.smalltalk_activity_ratio.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-blue-300/70">Sample Density</p>
              <p className="font-bold text-blue-300">{result.derived.sample_density.toFixed(1)}/sec</p>
            </div>
            <div>
              <p className="text-blue-300/70">GC Pressure</p>
              <p className="font-bold text-blue-300">{result.derived.gc_pressure.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Process Distribution */}
      <CollapsibleSection title="Process Distribution" icon={GitBranch}>
        <div className="space-y-3">
          {result.processes.map((proc, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-48 flex items-center gap-2">
                <span className="font-medium text-gray-200 text-sm truncate">{proc.name}</span>
                {proc.status !== 'normal' && <SeverityBadge severity={proc.status} />}
              </div>
              <div className="flex-1">
                <ProgressBar value={proc.percentage} color={proc.percentage > 15 && proc.name !== 'Mediagenix Launcher' ? 'orange' : 'blue'} />
              </div>
              <div className="w-20 text-right">
                <span className="font-mono text-sm font-medium text-white">{proc.percentage.toFixed(1)}%</span>
              </div>
              <div className="w-12 text-right">
                <span className="text-xs text-gray-500">@{proc.priority}</span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Top Methods (Totals) */}
      <CollapsibleSection title="Top Methods by Self-Time" icon={List}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-400">Method</th>
                <th className="text-left py-2 px-3 font-medium text-gray-400">Category</th>
                <th className="text-right py-2 px-3 font-medium text-gray-400">Self-Time</th>
                <th className="text-left py-2 px-3 font-medium text-gray-400 w-32">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {result.top_methods.map((method, i) => (
                <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-2 px-3 font-mono text-xs text-gray-200 max-w-xs truncate" title={method.method}>
                    {method.method}
                  </td>
                  <td className="py-2 px-3">
                    <CategoryBadge category={method.category} />
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-white">{method.percentage.toFixed(1)}%</td>
                  <td className="py-2 px-3">
                    <ProgressBar value={method.percentage} max={15} color={getColorForPercentage(method.percentage)} height="h-1.5" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Detected Patterns */}
      <CollapsibleSection
        title="Detected Patterns"
        icon={Target}
        badge={<span className="ml-2 px-2 py-0.5 text-xs bg-blue-900/30 text-blue-400 rounded-full">{result.patterns.length} found</span>}
      >
        <div className="space-y-3">
          {result.patterns.map((pattern, i) => (
            <div key={i} className={`p-4 rounded-lg border ${
              pattern.severity === 'high' ? 'bg-orange-900/20 border-orange-500/30' :
              pattern.severity === 'medium' ? 'bg-yellow-900/20 border-yellow-500/30' :
              pattern.severity === 'low' ? 'bg-blue-900/20 border-blue-500/30' :
              'bg-gray-700/30 border-gray-600'
            }`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {pattern.severity === 'high' && <AlertTriangle size={18} className="text-orange-400" />}
                  {pattern.severity === 'medium' && <AlertCircle size={18} className="text-yellow-400" />}
                  {pattern.severity === 'low' && <Info size={18} className="text-blue-400" />}
                  {pattern.severity === 'info' && <Info size={18} className="text-gray-400" />}
                  <h4 className="font-semibold text-white">{pattern.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{pattern.confidence}% confidence</span>
                  <SeverityBadge severity={pattern.severity} />
                </div>
              </div>
              <p className="text-sm text-gray-300">{pattern.description}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* User Scenario Reconstruction */}
      <CollapsibleSection title="User Scenario Reconstruction" icon={MousePointer}>
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-700/30 rounded-lg p-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Trigger Event</p>
              <p className="font-medium text-white">{result.scenario.trigger}</p>
            </div>
            <div className="bg-gray-700/30 rounded-lg p-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Impact</p>
              <p className="font-medium text-white">{result.scenario.impact}</p>
            </div>
          </div>

          <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30">
            <p className="text-xs font-medium text-blue-400 uppercase tracking-wide mb-2">What Happened</p>
            <p className="text-white">{result.scenario.action}</p>
            <p className="text-sm text-gray-400 mt-2">{result.scenario.context}</p>
          </div>

          {result.scenario.additional_factors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Contributing Factors</p>
              <ul className="space-y-1">
                {result.scenario.additional_factors.map((factor, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-gray-500 mt-1">-</span>
                    {factor}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Recommendations */}
      <CollapsibleSection title="Recommendations" icon={Lightbulb}>
        <div className="space-y-3">
          {result.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-4 p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 transition-colors">
              <div className={`p-2 rounded-lg ${
                rec.type === 'optimization' ? 'bg-purple-900/30' :
                rec.type === 'workaround' ? 'bg-green-900/30' :
                rec.type === 'investigation' ? 'bg-blue-900/30' :
                rec.type === 'configuration' ? 'bg-orange-900/30' :
                'bg-gray-700/30'
              }`}>
                {rec.type === 'optimization' && <TrendingUp size={20} className="text-purple-400" />}
                {rec.type === 'workaround' && <CheckCircle size={20} className="text-green-400" />}
                {rec.type === 'investigation' && <Target size={20} className="text-blue-400" />}
                {rec.type === 'configuration' && <RefreshCw size={20} className="text-orange-400" />}
                {rec.type === 'documentation' && <FileText size={20} className="text-gray-400" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-white">{rec.title}</h4>
                  <SeverityBadge severity={rec.priority} />
                </div>
                <p className="text-sm text-gray-400">{rec.description}</p>
                <p className="text-xs text-gray-500 mt-2">Effort: {rec.effort}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// Main Performance Analyzer View
export default function PerformanceAnalyzerView() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<PerformanceAnalysisResult[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });

  const handleFilesSelected = (newFiles: FileInfo[]) => {
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysisResults([]);
    setAnalysisProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      setAnalysisProgress({ current: i + 1, total: files.length });

      try {
        // Call Tauri backend for performance trace analysis
        const result = await invoke<PerformanceAnalysisResult>("analyze_performance_trace", {
          filePath: files[i].path
        });

        setAnalysisResults(prev => [...prev, result]);
      } catch (error) {
        logger.error('Performance analysis failed', {
          file: files[i].name,
          error: error instanceof Error ? error.message : String(error)
        });

        // Create error result placeholder
        const errorResult: PerformanceAnalysisResult = {
          filename: files[i].name,
          user: 'Unknown',
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          header: {
            samples: 0, avg_ms_per_sample: 0, scavenges: 0, inc_gcs: 0,
            stack_spills: 0, mark_stack_overflows: 0, weak_list_overflows: 0,
            jit_cache_spills: 0, active_time: 0, other_processes: 0, real_time: 0,
            profiling_overhead: 0
          },
          derived: { cpu_utilization: 0, smalltalk_activity_ratio: 0, sample_density: 0, gc_pressure: 0 },
          processes: [],
          top_methods: [],
          patterns: [{
            type: 'error',
            severity: 'high',
            title: 'Analysis Failed',
            description: error instanceof Error ? error.message : 'Unknown error occurred during analysis',
            confidence: 100
          }],
          scenario: {
            trigger: 'N/A',
            action: 'Analysis could not be completed',
            context: 'The performance trace could not be parsed',
            impact: 'Unable to determine',
            additional_factors: []
          },
          recommendations: [{
            type: 'investigation',
            priority: 'high',
            title: 'Check File Format',
            description: 'Ensure the file is a valid VisualWorks performance trace log',
            effort: 'Low'
          }],
          overall_severity: 'high',
          summary: 'Analysis failed - the file may not be a valid performance trace or may be corrupted.'
        };

        setAnalysisResults(prev => [...prev, errorResult]);
      }
    }

    setIsAnalyzing(false);
    setActiveTab(0);
  };

  const handleReset = () => {
    setFiles([]);
    setAnalysisResults([]);
    setActiveTab(0);
  };

  const handleExport = async (format: 'pdf' | 'json') => {
    const result = analysisResults[activeTab];
    if (!result) return;

    try {
      if (format === 'json') {
        const json = JSON.stringify(result, null, 2);
        await invoke("save_export_file", {
          content: json,
          filename: `${result.filename.replace('.log', '')}_analysis.json`,
          format: 'json'
        });
      } else {
        // PDF export would be handled by backend
        await invoke("export_performance_report", {
          result,
          format: 'pdf'
        });
      }
    } catch (error) {
      logger.error('Export failed', { format, error });
      alert(`Failed to export ${format.toUpperCase()}. Please try again.`);
    }
  };

  return (
    <div className="space-y-6">
      {analysisResults.length === 0 ? (
        /* Upload Section */
        <div className="space-y-6">
          <AnalyzerEntryPanel
            icon={<Cpu className="w-6 h-6 text-cyan-400" />}
            title="Performance Trace Analyzer"
            subtitle="Analyze CPU profiles and identify bottlenecks in VisualWorks Smalltalk"
            iconBgClassName="bg-cyan-500/20"
          >
            <div className="space-y-6">
              <FileUpload
                onFilesSelected={handleFilesSelected}
                files={files}
                onRemoveFile={handleRemoveFile}
                isAnalyzing={isAnalyzing}
              />

              {files.length > 0 && (
                <div className="flex justify-center">
                  <Button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    loading={isAnalyzing}
                    variant="primary"
                    size="lg"
                    icon={<Play size={20} />}
                  >
                    {isAnalyzing ? "Analyzing..." : `Analyze ${files.length} File${files.length > 1 ? 's' : ''}`}
                  </Button>
                </div>
              )}

              {isAnalyzing && (
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <Loader2 size={20} className="text-blue-400 animate-spin" />
                    <div>
                      <p className="font-medium text-blue-300">
                        Analyzing {analysisProgress.current} of {analysisProgress.total}...
                      </p>
                      <p className="text-sm text-blue-400/70">
                        Parsing header statistics, building call tree, detecting patterns
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AnalyzerEntryPanel>

          {/* Feature highlights */}
          <div className="grid md:grid-cols-3 gap-4 mt-12">
            <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
              <BarChart3 size={24} className="text-blue-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Comprehensive Metrics</h3>
              <p className="text-sm text-gray-400">Full breakdown of samples, GC activity, memory stats, and derived performance indicators.</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
              <Target size={24} className="text-purple-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Pattern Detection</h3>
              <p className="text-sm text-gray-400">Automatic identification of UI bottlenecks, database issues, sync overhead, and memory pressure.</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
              <Lightbulb size={24} className="text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Actionable Insights</h3>
              <p className="text-sm text-gray-400">Prioritized recommendations with effort estimates for code fixes, workarounds, and user guidance.</p>
            </div>
          </div>
        </div>
      ) : (
        /* Results Section */
        <div className="space-y-6">
          {/* Header with reset button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="p-2 bg-cyan-500/20 rounded-lg">
                <Cpu size={24} className="text-cyan-400" />
              </span>
              <div>
                <h2 className="text-2xl font-bold">Performance Analysis Results</h2>
                <p className="text-sm text-gray-400">{analysisResults.length} trace{analysisResults.length !== 1 ? 's' : ''} analyzed</p>
              </div>
            </div>
            <Button
              onClick={handleReset}
              variant="ghost"
              icon={<RefreshCw size={18} />}
            >
              New Analysis
            </Button>
          </div>

          {/* Tabs for multiple files */}
          {analysisResults.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {analysisResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => setActiveTab(i)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                    activeTab === i
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800/50 text-gray-300 border border-gray-700 hover:bg-gray-700/50'
                  }`}
                >
                  <FileText size={16} />
                  <span className="text-sm font-medium">{result.user}</span>
                  <SeverityBadge severity={result.overall_severity} />
                </button>
              ))}
            </div>
          )}

          {/* Active result */}
          <AnalysisResultView result={analysisResults[activeTab]} />

          {/* Export options */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button
              onClick={() => handleExport('json')}
              variant="ghost"
              icon={<Download size={18} />}
              className="border border-gray-600"
            >
              Export JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
