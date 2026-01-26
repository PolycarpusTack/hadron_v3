import { Ticket, RefreshCw, Sparkles, Link2 } from "lucide-react";
import AnalyzerEntryPanel from "./AnalyzerEntryPanel";
import JiraImportPanel from "./JiraImportPanel";
import JiraSyncStatus from "./JiraSyncStatus";

export default function JiraAnalyzerView() {
  return (
    <div className="space-y-6">
      <AnalyzerEntryPanel
        icon={<Ticket className="w-6 h-6 text-sky-400" />}
        title="JIRA Analyzer"
        subtitle="Sync and analyze JIRA issues for crash correlation and knowledge reuse"
        iconBgClassName="bg-sky-500/20"
      >
        <div className="space-y-3 text-sm text-gray-300">
          <p>
            Pull crash-relevant issues from your JIRA workspace, enrich them with relevance scoring,
            and export case files for RAG or investigation workflows.
          </p>
          <div className="text-xs text-gray-400">
            Tip: configure defaults in Settings → Integrations → JIRA.
          </div>
        </div>
      </AnalyzerEntryPanel>

      <JiraSyncStatus />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
          <RefreshCw className="w-6 h-6 text-sky-400 mb-3" />
          <h3 className="font-semibold text-white mb-1">Smart Sync</h3>
          <p className="text-sm text-gray-400">
            Pull issues by project, time window, and crash-relevance filters with safe JQL.
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
          <Sparkles className="w-6 h-6 text-purple-400 mb-3" />
          <h3 className="font-semibold text-white mb-1">RAG-Ready Export</h3>
          <p className="text-sm text-gray-400">
            Generate case files for downstream retrieval and analysis workflows.
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
          <Link2 className="w-6 h-6 text-emerald-400 mb-3" />
          <h3 className="font-semibold text-white mb-1">Traceable Links</h3>
          <p className="text-sm text-gray-400">
            Link issues to analyses for bidirectional crash correlation and updates.
          </p>
        </div>
      </div>

      <JiraImportPanel embedded />
    </div>
  );
}
