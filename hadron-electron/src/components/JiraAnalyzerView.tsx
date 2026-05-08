/**
 * JIRA Analyzer View
 * Shell component with sky-themed tab bar: Analyze Ticket, Project Feed, History
 */

import { useState, useEffect } from "react";
import {
  Ticket,
  Search,
  FolderOpen,
  History,
  AlertCircle,
  Loader2,
  Settings,
} from "lucide-react";
import AnalyzerEntryPanel from "./AnalyzerEntryPanel";
import TabBar from "./ui/TabBar";
import JiraTicketAnalyzer from "./jira/JiraTicketAnalyzer";
import JiraProjectFeed from "./jira/JiraProjectFeed";
import JiraAnalysisHistory from "./JiraAnalysisHistory";
import { isJiraEnabled } from "../services/jira";
import type { Analysis } from "../services/api";
import type { SettingsSection } from "./settings/types";

interface JiraAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
  onOpenSettings?: (section: SettingsSection) => void;
}

type TabId = "analyze" | "feed" | "history";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "analyze", label: "Analyze Ticket", icon: <Search className="w-4 h-4" /> },
  { id: "feed", label: "Project Feed", icon: <FolderOpen className="w-4 h-4" /> },
  { id: "history", label: "History", icon: <History className="w-4 h-4" /> },
];

export default function JiraAnalyzerView({ onAnalysisComplete, onOpenSettings }: JiraAnalyzerViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("analyze");
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    isJiraEnabled().then(setConfigured);
  }, []);

  const handleAnalysisComplete = (analysis: Analysis) => {
    onAnalysisComplete?.(analysis);
  };

  // Loading state while checking config
  if (configured === null) {
    return (
      <div className="space-y-6">
        <AnalyzerEntryPanel
          icon={<Ticket className="w-6 h-6 text-sky-400" />}
          title="JIRA Analyzer"
          subtitle="Analyze JIRA tickets with AI or browse issues from configured projects"
          iconBgClassName="bg-sky-500/20"
        >
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Checking JIRA configuration...</span>
          </div>
        </AnalyzerEntryPanel>
      </div>
    );
  }

  // Not configured state
  if (!configured) {
    return (
      <div className="space-y-6">
        <AnalyzerEntryPanel
          icon={<Ticket className="w-6 h-6 text-sky-400" />}
          title="JIRA Analyzer"
          subtitle="Analyze JIRA tickets with AI or browse issues from configured projects"
          iconBgClassName="bg-sky-500/20"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-yellow-300 font-medium">JIRA Not Configured</p>
              <p className="text-xs text-gray-400 mt-1">
                Enable JIRA integration in Settings &rarr; Integrations &rarr; JIRA to connect
                your Atlassian instance. You'll need your JIRA URL, email, and an API token.
              </p>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => onOpenSettings('jira')}
                  className="mt-3 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                  style={{ color: 'var(--hd-accent)' }}
                >
                  <Settings className="w-3 h-3" />
                  Configure JIRA →
                </button>
              )}
            </div>
          </div>
        </AnalyzerEntryPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnalyzerEntryPanel
        icon={<Ticket className="w-6 h-6 text-sky-400" />}
        title="JIRA Analyzer"
        subtitle="Analyze JIRA tickets with AI or browse issues from configured projects"
        iconBgClassName="bg-sky-500/20"
      >
        <div className="text-xs text-gray-400">
          Tip: configure defaults in Settings &rarr; Integrations &rarr; JIRA.
        </div>
      </AnalyzerEntryPanel>

      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} accentColor="sky" />

      {/* Tab Content — kept mounted to preserve local state across tab switches */}
      <div className={activeTab !== "analyze" ? "hidden" : ""}>
        <JiraTicketAnalyzer onAnalysisComplete={handleAnalysisComplete} />
      </div>
      <div className={activeTab !== "feed" ? "hidden" : ""}>
        <JiraProjectFeed onAnalysisComplete={handleAnalysisComplete} />
      </div>
      <div className={activeTab !== "history" ? "hidden" : ""}>
        <JiraAnalysisHistory onViewAnalysis={handleAnalysisComplete} />
      </div>
    </div>
  );
}
