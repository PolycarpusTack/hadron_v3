/**
 * JIRA Ticket Creation Modal
 * Allows users to preview and create a JIRA ticket from crash analysis
 */

import { useState, useEffect } from "react";
import {
  X,
  ExternalLink,
  Send,
  RefreshCw,
  Check,
  AlertCircle,
  Tag,
  FileText,
  AlertTriangle,
} from "lucide-react";
import type { Analysis } from "../services/api";
import {
  createJiraTicket,
  getJiraConfig,
  generateTicketSummary,
  formatAnalysisForJira,
  severityToJiraPriority,
  isJiraEnabled,
  type JiraConfig,
  type JiraPriority,
} from "../services/jira";

interface JiraTicketModalProps {
  analysis: Analysis;
  isOpen: boolean;
  onClose: () => void;
}

export default function JiraTicketModal({
  analysis,
  isOpen,
  onClose,
}: JiraTicketModalProps) {
  const [config, setConfig] = useState<JiraConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ ticketKey: string; ticketUrl: string } | null>(null);

  // Editable fields
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<JiraPriority>("Medium");
  const [labels, setLabels] = useState<string[]>([]);

  // Load config and initialize fields
  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen, analysis]);

  async function loadConfig() {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const enabled = await isJiraEnabled();
      if (!enabled) {
        setError("JIRA integration is not configured. Please configure it in Settings.");
        setIsLoading(false);
        return;
      }

      const jiraConfig = await getJiraConfig();
      setConfig(jiraConfig);

      // Initialize form fields from analysis
      setSummary(generateTicketSummary(analysis));
      setDescription(formatAnalysisForJira(analysis));
      setPriority(severityToJiraPriority(analysis.severity));
      setLabels([...jiraConfig.defaultLabels]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load JIRA config");
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreateTicket = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const result = await createJiraTicket({
        summary,
        description,
        priority,
        labels,
      });

      if (result.success && result.ticketKey && result.ticketUrl) {
        setSuccess({
          ticketKey: result.ticketKey,
          ticketUrl: result.ticketUrl,
        });
      } else {
        setError(result.error || "Failed to create ticket");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  const handleAddLabel = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const input = e.currentTarget;
      const value = input.value.trim();
      if (value && !labels.includes(value)) {
        setLabels([...labels, value]);
        input.value = "";
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Create JIRA Ticket</h2>
              {config && (
                <p className="text-xs text-gray-400">
                  Project: {config.projectKey} | Type: {config.issueType}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
              <span className="ml-3 text-gray-400">Loading JIRA configuration...</span>
            </div>
          ) : success ? (
            // Success state
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-green-400">Ticket Created!</h3>
                <p className="text-gray-400 mt-2">
                  Your JIRA ticket has been created successfully.
                </p>
              </div>
              <a
                href={success.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition font-semibold"
              >
                <ExternalLink className="w-5 h-5" />
                Open {success.ticketKey}
              </a>
            </div>
          ) : error && !config ? (
            // Configuration error state
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-500/20">
                <AlertTriangle className="w-8 h-8 text-yellow-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-yellow-400">JIRA Not Configured</h3>
                <p className="text-gray-400 mt-2">{error}</p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
              >
                Close
              </button>
            </div>
          ) : (
            // Form
            <>
              {/* Error banner */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Summary */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Summary
                </label>
                <input
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="Ticket summary..."
                />
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as JiraPriority)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="Highest">Highest</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Lowest">Lowest</option>
                </select>
              </div>

              {/* Labels */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Labels
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-xs"
                    >
                      <Tag className="w-3 h-3 text-blue-400" />
                      {label}
                      <button
                        onClick={() => handleRemoveLabel(label)}
                        className="hover:text-red-400 transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  onKeyDown={handleAddLabel}
                  placeholder="Type label and press Enter..."
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Description Preview */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Description Preview
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={10}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Uses JIRA wiki markup format
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && !success && config && (
          <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateTicket}
              disabled={isCreating || !summary.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition font-semibold"
            >
              {isCreating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Create Ticket
                </>
              )}
            </button>
          </div>
        )}

        {/* Close button for success state */}
        {success && (
          <div className="p-4 border-t border-gray-700 flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
