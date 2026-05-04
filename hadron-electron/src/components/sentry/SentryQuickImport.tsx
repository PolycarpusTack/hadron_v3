/**
 * Sentry Quick Import
 * Import a Sentry issue by URL or ID, preview it, then analyze
 */

import { useState } from "react";
import {
  Import,
  Search,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { fetchSentryIssue, parseSentryIssueUrl } from "../../services/sentry";
import logger from "../../services/logger";
import type { SentryIssue } from "../../types";
import SentryIssueRow from "./SentryIssueRow";

interface SentryQuickImportProps {
  analyzingIssueId: string | null;
  onAnalyze: (issue: SentryIssue) => void;
}

export default function SentryQuickImport({
  analyzingIssueId,
  onAnalyze,
}: SentryQuickImportProps) {
  const [importValue, setImportValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedIssue, setImportedIssue] = useState<SentryIssue | null>(null);

  const handleImport = async () => {
    if (!importValue.trim()) return;

    const issueId = parseSentryIssueUrl(importValue);
    if (!issueId) {
      setError(
        "Could not parse issue ID from input. Use a numeric ID, short ID (PROJ-123), or Sentry URL."
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const issue = await fetchSentryIssue(issueId);
      setImportedIssue(issue);
      setImportValue("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Quick import failed", { issueId, error: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Import Input */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Import Sentry Issue
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Paste a Sentry issue URL, numeric ID, or short ID (e.g., PROJ-123) to
          fetch and preview the issue before analyzing.
        </p>

        <div className="flex items-center gap-3">
          <Import className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={importValue}
            onChange={(e) => {
              setImportValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleImport();
            }}
            placeholder="https://sentry.io/.../issues/12345/ or PROJ-123"
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
          <button
            onClick={handleImport}
            disabled={loading || !importValue.trim()}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition flex items-center gap-2"
          >
            {loading ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
            Import
          </button>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {error}
          </p>
        )}
      </div>

      {/* Preview Card */}
      {importedIssue && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">
            Issue Preview
          </h3>
          <SentryIssueRow
            issue={importedIssue}
            expanded={true}
            onToggleExpand={() => {}}
            onAnalyze={() => onAnalyze(importedIssue)}
            analyzing={analyzingIssueId === importedIssue.id}
          />
        </div>
      )}

      {/* Placeholder when nothing imported */}
      {!importedIssue && !loading && (
        <div className="text-center py-12 text-gray-500">
          <Import className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>Import an issue to see its preview here</p>
          <p className="text-xs mt-1">
            You can then review it before running AI analysis
          </p>
        </div>
      )}
    </div>
  );
}
