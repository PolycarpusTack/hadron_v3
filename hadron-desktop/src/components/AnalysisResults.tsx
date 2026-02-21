import { Download, RotateCcw, Wrench, Clock, DollarSign } from "lucide-react";
import Button from "./ui/Button";
import type { AnalysisResult } from "../types/index";
import CollapsibleSection from "./CollapsibleSection";
import MultiPartAnalysisViewer from "./MultiPartAnalysisViewer";
import { getSeverityTextColor, getSeverityBgClasses } from "../utils/severity";

interface AnalysisResultsProps {
  result: AnalysisResult;
  onNewAnalysis: () => void;
}

export default function AnalysisResults({ result, onNewAnalysis }: AnalysisResultsProps) {
  const severityColor = getSeverityTextColor(result.severity);
  const severityBg = getSeverityBgClasses(result.severity);

  // Parse suggested_fixes from JSON string to array
  const suggestedFixes: string[] = typeof result.suggested_fixes === 'string'
    ? JSON.parse(result.suggested_fixes)
    : result.suggested_fixes;

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Analysis Results</h2>
          <p className="text-gray-400">{result.filename}</p>
        </div>
        <Button
          variant="primary"
          onClick={onNewAnalysis}
          icon={<RotateCcw />}
        >
          New Analysis
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Error Type */}
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Error Type</p>
          <p className="text-lg font-semibold">{result.error_type}</p>
        </div>

        {/* Severity */}
        <div className={`rounded-lg p-4 border ${severityBg}`}>
          <p className="text-sm text-gray-400 mb-1">Severity</p>
          <p className={`text-lg font-semibold ${severityColor}`}>
            {result.severity.toUpperCase()}
          </p>
        </div>

        {/* Cost */}
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <DollarSign className="w-4 h-4" />
            <span>Cost</span>
          </div>
          <p className="text-lg font-semibold text-green-400">
            ${result.cost.toFixed(4)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {result.tokens_used.toLocaleString()} tokens
          </p>
        </div>

        {/* Duration */}
        {result.analysis_duration_ms && (
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <Clock className="w-4 h-4" />
              <span>Duration</span>
            </div>
            <p className="text-lg font-semibold text-blue-400">
              {(result.analysis_duration_ms / 1000).toFixed(2)}s
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {result.ai_model}
            </p>
          </div>
        )}
      </div>

      {/* Root Cause - Multi-Part Analysis Viewer */}
      <MultiPartAnalysisViewer
        rootCause={result.root_cause}
        className="bg-gray-900/50"
      />

      {/* Suggested Fixes */}
      <CollapsibleSection
        title="Suggested Fixes"
        icon={<Wrench className="w-5 h-5" />}
        badge={
          <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-semibold">
            {suggestedFixes.length} {suggestedFixes.length === 1 ? 'Fix' : 'Fixes'}
          </span>
        }
        className="bg-gray-900/50"
      >
        <ol className="space-y-3">
          {suggestedFixes.map((fix, index) => (
            <li key={index} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-semibold">
                {index + 1}
              </div>
              <span className="text-gray-300 flex-1">{fix}</span>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t border-gray-700">
        <Button variant="secondary" icon={<Download />}>
          Export
        </Button>
        <Button variant="secondary">
          View Stack Trace
        </Button>
      </div>
    </div>
  );
}
