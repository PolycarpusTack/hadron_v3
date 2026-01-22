/**
 * A/B Testing Dashboard Component
 * Phase 2.3 - Displays RAG vs Baseline comparison results
 */

import { useState, useEffect } from "react";
import {
  FlaskConical,
  BarChart3,
  Timer,
  Star,
  ThumbsUp,
  Award,
  RefreshCw,
  Settings,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from "lucide-react";
import ABTestingService, {
  type ABTestConfig,
  type ABTestSummary,
} from "../services/ab-testing";

interface ABTestingDashboardProps {
  onClose?: () => void;
}

export default function ABTestingDashboard({ onClose }: ABTestingDashboardProps) {
  const [config, setConfig] = useState<ABTestConfig>(ABTestingService.getConfig());
  const [summary, setSummary] = useState<ABTestSummary | null>(null);
  const [winner, setWinner] = useState<"rag" | "baseline" | "inconclusive">("inconclusive");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = () => {
    setConfig(ABTestingService.getConfig());
    setSummary(ABTestingService.getSummary());
    setWinner(ABTestingService.getWinner());
  };

  const handleConfigChange = (updates: Partial<ABTestConfig>) => {
    ABTestingService.setConfig(updates);
    setConfig(ABTestingService.getConfig());
  };

  const handleReset = () => {
    if (confirm("Reset A/B test? This will clear all collected results.")) {
      ABTestingService.reset();
      refreshData();
    }
  };

  const formatPercent = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getComparisonIcon = (ragValue: number, baselineValue: number, higherIsBetter: boolean = true) => {
    const diff = ragValue - baselineValue;
    const threshold = higherIsBetter ? 0.05 : -0.05;

    if (Math.abs(diff) < 0.01) {
      return <Minus className="w-4 h-4 text-gray-400" />;
    }
    if ((higherIsBetter && diff > threshold) || (!higherIsBetter && diff < -threshold)) {
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    }
    return <TrendingDown className="w-4 h-4 text-red-400" />;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="text-xl font-bold">RAG A/B Testing</h2>
              <p className="text-sm text-gray-400">Compare RAG-enhanced vs baseline analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition ${
                showSettings ? "bg-purple-600" : "hover:bg-gray-700"
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={refreshData}
              className="p-2 hover:bg-gray-700 rounded-lg transition"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-lg transition"
              >
                <span className="text-xl">&times;</span>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Settings Panel */}
          {showSettings && (
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Test Configuration
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.ragEnabled}
                      onChange={(e) => handleConfigChange({ ragEnabled: e.target.checked })}
                      className="rounded"
                    />
                    <span>RAG Enabled</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    Allow RAG for new analyses
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.forceRag}
                      onChange={(e) => handleConfigChange({ forceRag: e.target.checked })}
                      className="rounded"
                    />
                    <span>Force RAG (All)</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    Use RAG for all analyses
                  </p>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm mb-1">
                    RAG Sample Rate: {config.ragSampleRate}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={config.ragSampleRate}
                    onChange={(e) => handleConfigChange({ ragSampleRate: parseInt(e.target.value) })}
                    className="w-full"
                    disabled={config.forceRag}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Percentage of analyses using RAG (for A/B testing)
                  </p>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-gray-700">
                <span className="text-xs text-gray-500">
                  Test started: {new Date(config.testStartDate).toLocaleDateString()}
                </span>
                <button
                  onClick={handleReset}
                  className="px-3 py-1 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition"
                >
                  Reset Test
                </button>
              </div>
            </div>
          )}

          {/* Winner Announcement */}
          {summary && summary.totalAnalyses >= 10 && (
            <div
              className={`p-4 rounded-lg border ${
                winner === "rag"
                  ? "bg-green-500/10 border-green-500/30"
                  : winner === "baseline"
                  ? "bg-orange-500/10 border-orange-500/30"
                  : "bg-gray-500/10 border-gray-500/30"
              }`}
            >
              <div className="flex items-center gap-3">
                {winner === "rag" ? (
                  <Award className="w-6 h-6 text-green-400" />
                ) : winner === "baseline" ? (
                  <BarChart3 className="w-6 h-6 text-orange-400" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-gray-400" />
                )}
                <div>
                  <p className="font-semibold">
                    {winner === "rag"
                      ? "RAG is performing better!"
                      : winner === "baseline"
                      ? "Baseline is performing better"
                      : "Results are inconclusive"}
                  </p>
                  <p className="text-sm text-gray-400">
                    {winner === "inconclusive"
                      ? "Need more data or metrics are too close to call"
                      : `Based on ${summary.totalAnalyses} analyses`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sample Size Warning */}
          {summary && summary.totalAnalyses < 10 && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-400">Need More Data</p>
                  <p className="text-sm text-gray-400">
                    Run at least 10 analyses in each group for meaningful comparison.
                    Current: {summary.ragAnalyses} RAG, {summary.baselineAnalyses} baseline.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Comparison Grid */}
          {summary && (
            <div className="grid grid-cols-3 gap-4">
              {/* Header Row */}
              <div className="p-4 bg-gray-800/30 rounded-lg">
                <h4 className="font-semibold text-gray-400">Metric</h4>
              </div>
              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <h4 className="font-semibold text-purple-400 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4" />
                  RAG ({summary.ragAnalyses})
                </h4>
              </div>
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <h4 className="font-semibold text-blue-400 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Baseline ({summary.baselineAnalyses})
                </h4>
              </div>

              {/* Rating */}
              <div className="p-4 bg-gray-800/30 rounded-lg flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-400" />
                <span>Avg Rating</span>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg flex items-center justify-between">
                <span className="text-xl font-bold">
                  {summary.ragAvgRating.toFixed(2)}
                </span>
                {getComparisonIcon(summary.ragAvgRating, summary.baselineAvgRating)}
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg">
                <span className="text-xl font-bold">
                  {summary.baselineAvgRating.toFixed(2)}
                </span>
              </div>

              {/* Acceptance Rate */}
              <div className="p-4 bg-gray-800/30 rounded-lg flex items-center gap-2">
                <ThumbsUp className="w-4 h-4 text-green-400" />
                <span>Acceptance Rate</span>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg flex items-center justify-between">
                <span className="text-xl font-bold">
                  {formatPercent(summary.ragAcceptanceRate)}
                </span>
                {getComparisonIcon(summary.ragAcceptanceRate, summary.baselineAcceptanceRate)}
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg">
                <span className="text-xl font-bold">
                  {formatPercent(summary.baselineAcceptanceRate)}
                </span>
              </div>

              {/* Gold Rate */}
              <div className="p-4 bg-gray-800/30 rounded-lg flex items-center gap-2">
                <Award className="w-4 h-4 text-yellow-400" />
                <span>Gold Promotion</span>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg flex items-center justify-between">
                <span className="text-xl font-bold">
                  {formatPercent(summary.ragGoldRate)}
                </span>
                {getComparisonIcon(summary.ragGoldRate, summary.baselineGoldRate)}
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg">
                <span className="text-xl font-bold">
                  {formatPercent(summary.baselineGoldRate)}
                </span>
              </div>

              {/* Duration */}
              <div className="p-4 bg-gray-800/30 rounded-lg flex items-center gap-2">
                <Timer className="w-4 h-4 text-blue-400" />
                <span>Avg Duration</span>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg flex items-center justify-between">
                <span className="text-xl font-bold">
                  {formatDuration(summary.ragAvgDuration)}
                </span>
                {getComparisonIcon(summary.ragAvgDuration, summary.baselineAvgDuration, false)}
              </div>
              <div className="p-4 bg-gray-800/50 rounded-lg">
                <span className="text-xl font-bold">
                  {formatDuration(summary.baselineAvgDuration)}
                </span>
              </div>
            </div>
          )}

          {/* No Data State */}
          {(!summary || summary.totalAnalyses === 0) && (
            <div className="text-center py-12">
              <FlaskConical className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-400 mb-2">No Test Data Yet</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                Run some analyses to start collecting A/B test data.
                Enable RAG to compare its performance against baseline.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-between items-center text-sm text-gray-500">
          <span>
            Data stored locally. Use "Reset Test" to start a new comparison period.
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
