/**
 * Release Notes Generator
 * Fix version picker, content type, module filter, AI enrichment toggles,
 * JQL filter, ticket preview, generate button.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Wand2,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  Eye,
  Settings2,
  Filter,
} from "lucide-react";
import {
  listFixVersions,
  previewTickets,
  generateReleaseNotes,
} from "../../services/release-notes";
import type {
  JiraFixVersion,
  ReleaseNoteTicketPreview,
  ReleaseNotesContentType,
} from "../../types";
import logger from "../../services/logger";

interface Props {
  onGenerated: (id: number) => void;
  onGenerationStart?: (requestId: string) => void;
  isGenerating: boolean;
}

export default function ReleaseNotesGenerator({ onGenerated, onGenerationStart, isGenerating }: Props) {
  // Fix version state
  const [fixVersions, setFixVersions] = useState<JiraFixVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Config state
  const [contentType, setContentType] = useState<ReleaseNotesContentType>("both");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jqlFilter, setJqlFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");

  // AI enrichment toggles
  const [rewriteDescriptions, setRewriteDescriptions] = useState(true);
  const [generateKeywords, setGenerateKeywords] = useState(true);
  const [classifyModules, setClassifyModules] = useState(true);
  const [detectBreakingChanges, setDetectBreakingChanges] = useState(true);

  // Preview state
  const [previewedTickets, setPreviewedTickets] = useState<ReleaseNoteTicketPreview[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Load fix versions on mount
  useEffect(() => {
    loadFixVersions();
  }, []);

  const loadFixVersions = async () => {
    setLoadingVersions(true);
    setError(null);
    try {
      const versions = await listFixVersions();
      // Sort: unreleased first, then by name descending
      versions.sort((a, b) => {
        if (a.released !== b.released) return a.released ? 1 : -1;
        return b.name.localeCompare(a.name);
      });
      setFixVersions(versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingVersions(false);
    }
  };

  const handlePreview = useCallback(async () => {
    if (!selectedVersion) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const modules = moduleFilter
        ? moduleFilter.split(",").map((m) => m.trim()).filter(Boolean)
        : undefined;
      const tickets = await previewTickets(
        selectedVersion,
        contentType,
        jqlFilter || undefined,
        modules,
      );
      setPreviewedTickets(tickets);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPreview(false);
    }
  }, [selectedVersion, contentType, jqlFilter, moduleFilter]);

  const handleGenerate = useCallback(async () => {
    if (!selectedVersion) return;
    setError(null);
    try {
      const requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `rn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      onGenerationStart?.(requestId);

      const modules = moduleFilter
        ? moduleFilter.split(",").map((m) => m.trim()).filter(Boolean)
        : undefined;
      const result = await generateReleaseNotes({
        fixVersion: selectedVersion,
        contentType,
        requestId,
        jqlFilter: jqlFilter || undefined,
        moduleFilter: modules,
        aiEnrichment: {
          rewriteDescriptions,
          generateKeywords,
          classifyModules,
          detectBreakingChanges,
        },
      });
      // result has id from the backend
      const resultObj = result as { id: number };
      onGenerated(resultObj.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      logger.error("Release notes generation failed", { error: err });
    }
  }, [
    selectedVersion,
    contentType,
    jqlFilter,
    moduleFilter,
    rewriteDescriptions,
    generateKeywords,
    classifyModules,
    detectBreakingChanges,
    onGenerated,
    onGenerationStart,
  ]);

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Fix Version Selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Filter className="w-4 h-4 text-amber-400" />
          Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fix Version */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Fix Version
            </label>
            <select
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              disabled={loadingVersions}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none"
            >
              <option value="">
                {loadingVersions ? "Loading versions..." : "Select a fix version"}
              </option>
              {fixVersions.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name} {v.released ? "(Released)" : ""} {v.archived ? "(Archived)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Content Type */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Content Type
            </label>
            <div className="flex gap-2">
              {(["both", "features", "fixes"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setContentType(type)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentType === type
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-gray-900 text-gray-400 border border-gray-600 hover:border-gray-500"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced Options Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="mt-4 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Advanced Options
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="mt-4 space-y-4 pt-4 border-t border-gray-700">
            {/* JQL Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Custom JQL Filter (overrides default)
              </label>
              <input
                type="text"
                value={jqlFilter}
                onChange={(e) => setJqlFilter(e.target.value)}
                placeholder='e.g., project = "MGXPRODUCT" AND fixVersion = "2025r2"'
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-400 outline-none"
              />
            </div>

            {/* Module Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Module Filter (comma-separated)
              </label>
              <input
                type="text"
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                placeholder="e.g., core_module, contract_module, linear_scheduling_module"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-400 outline-none"
              />
            </div>

            {/* AI Enrichment Toggles */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                AI Enrichment
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Rewrite descriptions", checked: rewriteDescriptions, set: setRewriteDescriptions },
                  { label: "Generate keywords", checked: generateKeywords, set: setGenerateKeywords },
                  { label: "Classify modules", checked: classifyModules, set: setClassifyModules },
                  { label: "Detect breaking changes", checked: detectBreakingChanges, set: setDetectBreakingChanges },
                ].map(({ label, checked, set }) => (
                  <label
                    key={label}
                    className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => set(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-900 text-amber-400 focus:ring-amber-400"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handlePreview}
          disabled={!selectedVersion || loadingPreview || isGenerating}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {loadingPreview ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          Preview Tickets
        </button>

        <button
          onClick={handleGenerate}
          disabled={!selectedVersion || isGenerating}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 rounded-lg text-sm font-bold transition-colors"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          Generate Release Notes
        </button>
      </div>

      {/* Ticket Preview Table */}
      {showPreview && previewedTickets.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-300">
              <Search className="w-4 h-4 inline mr-1.5 text-amber-400" />
              {previewedTickets.length} tickets found
            </h4>
            <button
              onClick={() => setShowPreview(false)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Hide
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/50 sticky top-0">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-2">Key</th>
                  <th className="px-4 py-2">Summary</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {previewedTickets.map((ticket) => (
                  <tr key={ticket.key} className="text-gray-300 hover:bg-gray-800/30">
                    <td className="px-4 py-2 font-mono text-amber-400 text-xs">
                      {ticket.key}
                    </td>
                    <td className="px-4 py-2">{ticket.summary}</td>
                    <td className="px-4 py-2 text-gray-400">{ticket.issueType}</td>
                    <td className="px-4 py-2 text-gray-400">{ticket.priority}</td>
                    <td className="px-4 py-2 text-gray-400">{ticket.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPreview && previewedTickets.length === 0 && !loadingPreview && (
        <div className="text-center py-8 text-gray-500 text-sm">
          No tickets found matching the criteria.
        </div>
      )}
    </div>
  );
}
