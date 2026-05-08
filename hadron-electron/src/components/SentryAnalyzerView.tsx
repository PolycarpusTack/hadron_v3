/**
 * Sentry Analyzer View
 * Shell component with config check, emerald tab bar, and analysis orchestration
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
import type { SettingsSection } from "./settings/types";

// Sub-components
import SentryIssueBrowser from "./sentry/SentryIssueBrowser";
import SentryQuickImport from "./sentry/SentryQuickImport";
import SentryAnalysisHistory from "./sentry/SentryAnalysisHistory";
import TabBar from "./ui/TabBar";

interface SentryAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
  onOpenSettings?: (section: SettingsSection) => void;
}

type TabId = "browse" | "import" | "history";

export default function SentryAnalyzerView({ onAnalysisComplete, onOpenSettings }: SentryAnalyzerViewProps) {
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

  const tabs = useMemo(() => [
    { id: "browse" as TabId, label: "Browse Issues", icon: <Search className="w-4 h-4" />, count: browseIssueCount || undefined },
    { id: "import" as TabId, label: "Quick Import", icon: <Import className="w-4 h-4" /> },
    { id: "history" as TabId, label: "Analysis History", icon: <History className="w-4 h-4" /> },
  ], [browseIssueCount]);

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
        {onOpenSettings && (
          <button
            type="button"
            onClick={() => onOpenSettings('sentry')}
            className="mt-3 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            style={{ color: 'var(--hd-accent)' }}
          >
            <Settings className="w-3 h-3" />
            Configure Sentry →
          </button>
        )}
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

      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} accentColor="orange" />

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
