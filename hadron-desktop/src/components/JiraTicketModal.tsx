/**
 * JIRA Ticket Creation Modal
 * Allows users to preview and create a JIRA ticket from crash analysis
 */

import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
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
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import type { Analysis } from "../services/api";
import {
  createJiraTicket,
  getJiraConfig,
  generateTicketSummary,
  formatAnalysisForJira,
  severityToJiraPriority,
  isJiraEnabled,
  listJiraProjects,
  getCachedJiraProjects,
  type JiraConfig,
  type JiraPriority,
  type JiraProjectInfo,
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
  const [projectKey, setProjectKey] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<JiraPriority>("Medium");
  const [labels, setLabels] = useState<string[]>([]);
  const [projects, setProjects] = useState<JiraProjectInfo[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

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
    setProjectsLoading(true);

    try {
      const enabled = await isJiraEnabled();
      if (!enabled) {
        setError("JIRA integration is not configured. Please configure it in Settings.");
        setIsLoading(false);
        return;
      }

      const cached = getCachedJiraProjects();
      if (cached.projects.length > 0) {
        setProjects(cached.projects);
      }

      const jiraConfig = await getJiraConfig();
      setConfig(jiraConfig);

      const projectList = await listJiraProjects();
      if (projectList.length > 0) {
        setProjects(projectList);
      }

      const defaultProject =
        jiraConfig.projectKey ||
        (projectList.length === 1 ? projectList[0].key : "");
      setProjectKey(defaultProject);

      // Initialize form fields from analysis
      setSummary(generateTicketSummary(analysis));
      setDescription(formatAnalysisForJira(analysis));
      setPriority(severityToJiraPriority(analysis.severity));
      setLabels([...jiraConfig.defaultLabels]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load JIRA config");
    } finally {
      setIsLoading(false);
      setProjectsLoading(false);
    }
  }

  const handleCreateTicket = async () => {
    setIsCreating(true);
    setError(null);

    try {
      if (!projectKey.trim()) {
        setError("Project key is required");
        setIsCreating(false);
        return;
      }

      const result = await createJiraTicket({
        projectKey: projectKey.trim().toUpperCase(),
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

  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const knownProjectKeys = projects.map((project) => project.key.toUpperCase());
  const hasProjectList = projects.length > 0;
  const isUnknownProject = hasProjectList && normalizedProjectKey.length > 0 && !knownProjectKeys.includes(normalizedProjectKey);

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
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
              <Button
                onClick={() => open(success.ticketUrl)}
                variant="primary"
                size="lg"
                icon={<ExternalLink />}
                className="font-semibold px-6 py-3"
              >
                Open {success.ticketKey}
              </Button>
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
              <Button
                onClick={onClose}
                variant="secondary"
                size="lg"
                className="px-6"
              >
                Close
              </Button>
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

              {/* Project */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Project Key
                </label>
                <input
                  type="text"
                  list="jira-projects"
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                  placeholder={projectsLoading ? "Loading projects..." : "Start typing a project key"}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none uppercase"
                />
                <datalist id="jira-projects">
                  {projects.map((project) => (
                    <option key={project.key} value={project.key}>
                      {project.name}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-gray-400 mt-1">
                  {projects.length > 0
                    ? "Select a project from your JIRA workspace"
                    : "Enter a project key (e.g., CRASH, BUG)"}
                </p>
                {isUnknownProject && (
                  <p className="text-xs text-yellow-400 mt-1">
                    This project key was not found in your JIRA workspace list.
                  </p>
                )}
              </div>

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
          <div className="p-4 border-t border-gray-700 flex items-center justify-between gap-3">
            {!normalizedProjectKey && (
              <p className="text-xs text-gray-500">
                Select a project key to enable ticket creation.
              </p>
            )}
            {normalizedProjectKey && !summary.trim() && (
              <p className="text-xs text-gray-500">
                Add a summary to enable ticket creation.
              </p>
            )}
            <Button
              onClick={onClose}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTicket}
              disabled={!summary.trim() || !normalizedProjectKey}
              loading={isCreating}
              variant="primary"
              size="lg"
              icon={<Send />}
              className="font-semibold px-6 disabled:bg-gray-600"
            >
              {isCreating ? "Creating..." : "Create Ticket"}
            </Button>
          </div>
        )}

        {/* Close button for success state */}
        {success && (
          <div className="p-4 border-t border-gray-700 flex justify-end">
            <Button
              onClick={onClose}
              variant="secondary"
              size="lg"
              className="px-6"
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
