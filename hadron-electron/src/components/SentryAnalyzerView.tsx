/**
 * Sentry Analyzer View
 * Shell component with config check, emerald tab bar, and analysis orchestration
 */

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Search,
  RefreshCw,
  Settings,
  Import,
  History,
} from "lucide-react";
import {
  getSentryConfig,
  isSentryEnabled,
  analyzeSentryIssue,
  getCachedSentryProjects,
} from "../services/sentry";
import { getAnalysisById } from "../services/api";
import type { Analysis } from "../services/api";
import { AnalysisProgressBar } from "./AnalysisProgressBar";
import logger from "../services/logger";
import type { SentryConfig, SentryIssue, SentryProjectInfo } from "../types";

// Sub-components
import SentryIssueBrowser from "./sentry/SentryIssueBrowser";
import SentryQuickImport from "./sentry/SentryQuickImport";
import SentryAnalysisHistory from "./sentry/SentryAnalysisHistory";

interface SentryAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
}

type TabId = "browse" | "import" | "history";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "browse", label: "Browse Issues", icon: <Search className="w-4 h-4" /> },
  { id: "import", label: "Quick Import", icon: <Import className="w-4 h-4" /> },
  { id: "history", label: "Analysis History", icon: <History className="w-4 h-4" /> },
];

export default function SentryAnalyzerView({ onAnalysisComplete }: SentryAnalyzerViewProps) {
  // Config state
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [config, setConfig] = useState<SentryConfig | null>(null);
  const [projects, setProjects] = useState<SentryProjectInfo[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("browse");

  // Analysis state
  const [analyzingIssueId, setAnalyzingIssueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Issue count for browse tab badge
  const [browseIssueCount, setBrowseIssueCount] = useState(0);

  // Check configuration on mount
  useEffect(() => {
    checkConfig();
  }, []);

  async function checkConfig() {
    try {
      const enabled = await isSentryEnabled();
      setConfigured(enabled);

      if (enabled) {
        const cfg = await getSentryConfig();
        setConfig(cfg);

        const cached = getCachedSentryProjects();
        setProjects(cached.projects);
      }
    } catch (err) {
      logger.error("Failed to check Sentry config", { error: String(err) });
      setConfigured(false);
    }
  }

  const handleAnalyze = useCallback(async (issue: SentryIssue) => {
    setAnalyzingIssueId(issue.id);
    setError(null);

    try {
      const result = await analyzeSentryIssue(issue.id);
      const fullAnalysis = await getAnalysisById(result.id);
      if (onAnalysisComplete) {
        onAnalysisComplete(fullAnalysis);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to analyze ${issue.shortId}: ${msg}`);
      logger.error("Sentry issue analysis failed", { issueId: issue.id, error: msg });
    } finally {
      setAnalyzingIssueId(null);
    }
  }, [onAnalysisComplete]);

  const handleViewAnalysis = useCallback((analysis: Analysis) => {
    if (onAnalysisComplete) {
      onAnalysisComplete(analysis);
    }
  }, [onAnalysisComplete]);

  // Loading state
  if (configured === null) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-6 h-6 text-orange-400 animate-spin" />
        <span className="ml-3 text-gray-400">Checking Sentry configuration...</span>
      </div>
    );
  }

  // Not configured state
  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="p-4 bg-orange-500/10 rounded-full mb-4">
          <Shield className="w-10 h-10 text-orange-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Sentry Not Configured</h2>
        <p className="text-gray-400 mb-4 max-w-md">
          Set up your Sentry integration in Settings &gt; Integrations to start
          analyzing Sentry issues with AI.
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Settings className="w-4 h-4" />
          <span>Settings &gt; Integrations &gt; Sentry Integration</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="p-2 bg-orange-500/20 rounded-lg">
            <Shield className="w-6 h-6 text-orange-400" />
          </span>
          <div>
            <h2 className="text-2xl font-bold">Sentry Analyzer</h2>
            <p className="text-sm text-gray-400">Browse and analyze Sentry issues with AI</p>
          </div>
        </div>
      </div>

      {/* Analysis Progress Bar (visible from any tab) */}
      {analyzingIssueId && (
        <AnalysisProgressBar isAnalyzing={true} />
      )}

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-1 overflow-x-auto pb-px" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "browse" && browseIssueCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300 rounded-full">
                  {browseIssueCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "browse" && config && (
        <SentryIssueBrowser
          config={config}
          projects={projects}
          analyzingIssueId={analyzingIssueId}
          onAnalyze={handleAnalyze}
          onIssueCountChange={setBrowseIssueCount}
        />
      )}

      {activeTab === "import" && (
        <SentryQuickImport
          analyzingIssueId={analyzingIssueId}
          onAnalyze={handleAnalyze}
        />
      )}

      {activeTab === "history" && (
        <SentryAnalysisHistory
          onViewAnalysis={handleViewAnalysis}
        />
      )}
    </div>
  );
}
