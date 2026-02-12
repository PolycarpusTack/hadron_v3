/**
 * JIRA Settings Component
 * Allows users to configure JIRA integration for ticket creation
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  Settings,
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  X,
  Plus,
  Tag,
} from "lucide-react";
import {
  getJiraConfig,
  saveJiraConfig,
  testJiraConnection,
  clearJiraConfigCache,
  listJiraProjects,
  getCachedJiraProjects,
  type JiraConfig,
} from "../services/jira";
import { storeApiKey, getApiKey, deleteApiKey } from "../services/secure-storage";
import logger from "../services/logger";

interface JiraSettingsProps {
  onConfigChange?: () => void;
}

const ISSUE_TYPES = ["Bug", "Task", "Story", "Epic", "Incident", "Problem"];

export default function JiraSettings({ onConfigChange }: JiraSettingsProps) {
  const [config, setConfig] = useState<JiraConfig>({
    enabled: false,
    baseUrl: "",
    projectKey: "",
    email: "",
    issueType: "Bug",
    defaultLabels: ["crash-analysis", "hadron"],
  });
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [projects, setProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [projectsUpdatedAt, setProjectsUpdatedAt] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Track timeouts for cleanup
  const timeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());

  const safeTimeout = useCallback((callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      callback();
    }, delay);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const savedConfig = await getJiraConfig();
      setConfig(savedConfig);

      // Check if API token exists
      const token = await getApiKey("jira");
      setHasToken(!!token);
      if (token) {
        setApiToken(token);
      }

      const cached = getCachedJiraProjects();
      setProjects(cached.projects);
      setProjectsUpdatedAt(cached.updatedAt);
    } catch (error) {
      logger.error("Failed to load JIRA config", { error });
    }
  }

  const handleRefreshProjects = async () => {
    setProjectsLoading(true);
    try {
      const fetched = await listJiraProjects();
      setProjects(fetched);
      const cached = getCachedJiraProjects();
      setProjectsUpdatedAt(cached.updatedAt);
    } catch (error) {
      logger.error("Failed to refresh JIRA projects", { error });
    } finally {
      setProjectsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Validate required fields if enabled
      if (config.enabled) {
        if (!config.baseUrl) {
          setSaveMessage("JIRA URL is required");
          setIsSaving(false);
          return;
        }
        if (!config.email) {
          setSaveMessage("Email is required");
          setIsSaving(false);
          return;
        }
        if (!apiToken && !hasToken) {
          setSaveMessage("API Token is required");
          setIsSaving(false);
          return;
        }
      }

      // Save API token if provided
      if (apiToken) {
        await storeApiKey("jira", apiToken);
        setHasToken(true);
      }

      // Save config
      await saveJiraConfig(config);
      clearJiraConfigCache();

      setSaveMessage("JIRA settings saved successfully!");
      safeTimeout(() => setSaveMessage(null), 3000);

      if (onConfigChange) {
        onConfigChange();
      }
    } catch (error) {
      setSaveMessage(`Failed to save: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      // Save current config first
      if (apiToken) {
        await storeApiKey("jira", apiToken);
        setHasToken(true);
      }
      await saveJiraConfig(config);
      clearJiraConfigCache();

      const result = await testJiraConnection();
      setTestResult(result);

      if (result.success) {
        await handleRefreshProjects();
      }

      if (result.success) {
        safeTimeout(() => setTestResult(null), 5000);
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleClearToken = async () => {
    if (confirm("Are you sure you want to clear your JIRA API token?")) {
      await deleteApiKey("jira");
      setApiToken("");
      setHasToken(false);
      setSaveMessage("API token cleared");
      safeTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handleAddLabel = () => {
    if (newLabel.trim() && !config.defaultLabels.includes(newLabel.trim())) {
      setConfig({
        ...config,
        defaultLabels: [...config.defaultLabels, newLabel.trim()],
      });
      setNewLabel("");
    }
  };

  const handleRemoveLabel = (label: string) => {
    setConfig({
      ...config,
      defaultLabels: config.defaultLabels.filter((l) => l !== label),
    });
  };

  return (
    <div className="space-y-4 p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Settings className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-blue-300">JIRA Integration</h3>
            <p className="text-xs text-gray-400">Create tickets from crash analysis</p>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={async (e) => {
              const enabled = e.target.checked;
              const updated = { ...config, enabled };
              setConfig(updated);
              if (!enabled) {
                await saveJiraConfig(updated);
                clearJiraConfigCache();
                if (onConfigChange) {
                  onConfigChange();
                }
              }
            }}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium">Enable</span>
        </label>
      </div>

      {/* Configuration fields (only show when enabled) */}
      {config.enabled && (
        <div className="space-y-4 pt-4 border-t border-blue-500/20">
          {/* JIRA URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              JIRA URL
            </label>
            <input
              type="url"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://company.atlassian.net"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Your Atlassian Cloud or JIRA Server URL
            </p>
          </div>

          {/* Default Project Key (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Default Project Key (Optional)
            </label>
            <input
              type="text"
              list="jira-projects-settings"
              value={config.projectKey}
              onChange={(e) =>
                setConfig({ ...config, projectKey: e.target.value.toUpperCase() })
              }
              placeholder="CRASH"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 uppercase"
            />
            <datalist id="jira-projects-settings">
              {projects.map((project) => (
                <option key={project.key} value={project.key}>
                  {project.name}
                </option>
              ))}
            </datalist>
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to select a project when creating a ticket
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>
                Projects cached: {projects.length}
                {projectsUpdatedAt ? ` • Updated ${new Date(projectsUpdatedAt).toLocaleString()}` : ""}
              </span>
              <button
                type="button"
                onClick={handleRefreshProjects}
                disabled={projectsLoading}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${projectsLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              JIRA Account Email
            </label>
            <input
              type="email"
              value={config.email}
              onChange={(e) => setConfig({ ...config, email: e.target.value })}
              placeholder="you@company.com"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* API Token */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-400">
                API Token
              </label>
              {hasToken && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <Check className="w-3 h-3" />
                  Token stored
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={hasToken ? "••••••••••••" : "Enter API token"}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
                >
                  {showToken ? (
                    <EyeOff className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
              {hasToken && (
                <button
                  onClick={handleClearToken}
                  className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition text-sm"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Create at{" "}
              <button
                type="button"
                onClick={() => open("https://id.atlassian.com/manage-profile/security/api-tokens")}
                className="text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                Atlassian API Tokens <ExternalLink className="w-3 h-3" />
              </button>
            </p>
          </div>

          {/* Issue Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Default Issue Type
            </label>
            <select
              value={config.issueType}
              onChange={(e) => setConfig({ ...config, issueType: e.target.value })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              {ISSUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Default Labels */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Default Labels
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {config.defaultLabels.map((label) => (
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
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddLabel();
                  }
                }}
                placeholder="Add label..."
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleAddLabel}
                disabled={!newLabel.trim()}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Test Connection */}
          <button
            onClick={handleTestConnection}
            disabled={isTesting || !config.baseUrl || !config.projectKey || !config.email || (!apiToken && !hasToken)}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2 text-sm"
          >
            {isTesting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Testing Connection...
              </>
            ) : (
              <>
                <Settings className="w-4 h-4" />
                Test Connection
              </>
            )}
          </button>

          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm ${
                testResult.success
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}
            >
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            </div>
          )}

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2 text-sm font-semibold"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Save JIRA Settings
              </>
            )}
          </button>

          {saveMessage && (
            <div
              className={`p-3 rounded-lg text-sm ${
                saveMessage.includes("success")
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}
            >
              {saveMessage}
            </div>
          )}
        </div>
      )}

      {/* Disabled state info */}
      {!config.enabled && (
        <p className="text-xs text-gray-500 pt-2">
          Enable JIRA integration to create tickets directly from crash analysis results.
        </p>
      )}
    </div>
  );
}
