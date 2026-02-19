/**
 * Sentry Settings Component
 * Allows users to configure Sentry integration for issue analysis
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield,
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import Button from "./ui/Button";
import {
  getSentryConfig,
  saveSentryConfig,
  testSentryConnection,
  clearSentryConfigCache,
  listSentryProjects,
  getCachedSentryProjects,
} from "../services/sentry";
import { storeApiKey, getApiKey, deleteApiKey } from "../services/secure-storage";
import logger from "../services/logger";
import type { SentryConfig, SentryProjectInfo } from "../types";

interface SentrySettingsProps {
  onConfigChange?: () => void;
}

export default function SentrySettings({ onConfigChange }: SentrySettingsProps) {
  const [config, setConfig] = useState<SentryConfig>({
    enabled: false,
    baseUrl: "https://sentry.io",
    organization: "",
    defaultProject: "",
  });
  const [authToken, setAuthToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<SentryProjectInfo[]>([]);
  const [projectsUpdatedAt, setProjectsUpdatedAt] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Track timeouts for cleanup
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

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
      const savedConfig = await getSentryConfig();
      setConfig(savedConfig);

      // Check if auth token exists
      const token = await getApiKey("sentry");
      setHasToken(!!token);
      if (token) {
        setAuthToken(token);
      }

      const cached = getCachedSentryProjects();
      setProjects(cached.projects);
      setProjectsUpdatedAt(cached.updatedAt);
    } catch (error) {
      logger.error("Failed to load Sentry config", { error });
    }
  }

  const handleRefreshProjects = async () => {
    setProjectsLoading(true);
    try {
      const fetched = await listSentryProjects();
      setProjects(fetched);
      const cached = getCachedSentryProjects();
      setProjectsUpdatedAt(cached.updatedAt);
    } catch (error) {
      logger.error("Failed to refresh Sentry projects", { error });
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
          setSaveMessage("Sentry URL is required");
          setIsSaving(false);
          return;
        }
        if (!config.organization) {
          setSaveMessage("Organization slug is required");
          setIsSaving(false);
          return;
        }
        if (!authToken && !hasToken) {
          setSaveMessage("Auth Token is required");
          setIsSaving(false);
          return;
        }
      }

      // Save auth token if provided
      if (authToken) {
        await storeApiKey("sentry", authToken);
        setHasToken(true);
      }

      // Save config
      await saveSentryConfig(config);
      clearSentryConfigCache();

      setSaveMessage("Sentry settings saved successfully!");
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
      if (authToken) {
        await storeApiKey("sentry", authToken);
        setHasToken(true);
      }
      await saveSentryConfig(config);
      clearSentryConfigCache();

      const result = await testSentryConnection();
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
    if (confirm("Are you sure you want to clear your Sentry auth token?")) {
      await deleteApiKey("sentry");
      setAuthToken("");
      setHasToken(false);
      setSaveMessage("Auth token cleared");
      safeTimeout(() => setSaveMessage(null), 2000);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-orange-500/10 rounded-lg border border-orange-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="font-semibold text-orange-300">Sentry Integration</h3>
            <p className="text-xs text-gray-400">Analyze Sentry issues with AI</p>
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
                await saveSentryConfig(updated);
                clearSentryConfigCache();
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
        <div className="space-y-4 pt-4 border-t border-orange-500/20">
          {/* Sentry URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Sentry Instance URL
            </label>
            <input
              type="url"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://sentry.io"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use https://sentry.io for Sentry SaaS, or your self-hosted URL
            </p>
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Organization Slug
            </label>
            <input
              type="text"
              value={config.organization}
              onChange={(e) => setConfig({ ...config, organization: e.target.value })}
              placeholder="my-org"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Found in your Sentry URL: sentry.io/organizations/<strong>my-org</strong>/
            </p>
          </div>

          {/* Auth Token */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-400">
                Auth Token
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
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={hasToken ? "••••••••••••" : "Enter auth token"}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:border-orange-500"
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
                <Button
                  onClick={handleClearToken}
                  variant="ghost-danger"
                  size="sm"
                >
                  Clear
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Create at{" "}
              <a
                href="https://sentry.io/settings/account/api/auth-tokens/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:underline inline-flex items-center gap-1"
              >
                Sentry Auth Tokens <ExternalLink className="w-3 h-3" />
              </a>
              {" "}— requires project:read scope
            </p>
          </div>

          {/* Default Project */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Default Project (Optional)
            </label>
            <select
              value={config.defaultProject}
              onChange={(e) => setConfig({ ...config, defaultProject: e.target.value })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="">Select a project...</option>
              {projects.map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.name} ({project.slug})
                  {project.platform ? ` — ${project.platform}` : ""}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>
                Projects cached: {projects.length}
                {projectsUpdatedAt
                  ? ` • Updated ${new Date(projectsUpdatedAt).toLocaleString()}`
                  : ""}
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

          {/* Test Connection */}
          <Button
            onClick={handleTestConnection}
            disabled={
              isTesting || !config.baseUrl || !config.organization || (!authToken && !hasToken)
            }
            variant="warning"
            fullWidth
            loading={isTesting}
            icon={<Shield />}
          >
            {isTesting ? "Testing Connection..." : "Test Connection"}
          </Button>

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
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="success"
            fullWidth
            loading={isSaving}
            icon={<Check />}
            className="font-semibold"
          >
            {isSaving ? "Saving..." : "Save Sentry Settings"}
          </Button>

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
          Enable Sentry integration to browse and analyze Sentry issues with AI.
        </p>
      )}
    </div>
  );
}
