/**
 * KeeperSettings Component
 *
 * Provides UI for configuring Keeper Secrets Manager integration.
 * Allows users to connect to Keeper and map secrets to AI providers
 * without ever seeing the actual API key values.
 */

import { useState, useEffect } from "react";
import {
  Shield,
  Key,
  Link,
  Unlink,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  ExternalLink,
  Info,
  X,
} from "lucide-react";
import {
  getKeeperStatus,
  initializeKeeper,
  listKeeperSecrets,
  disconnectKeeper,
  getKeeperConfig,
  saveKeeperConfig,
  type KeeperStatus,
  type KeeperSecretInfo,
  type KeeperConfig,
} from "../services/keeper";
import logger from "../services/logger";

interface KeeperSettingsProps {
  onConfigChange?: () => void;
}

export default function KeeperSettings({ onConfigChange }: KeeperSettingsProps) {
  // State
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [secrets, setSecrets] = useState<KeeperSecretInfo[]>([]);
  const [config, setConfig] = useState<KeeperConfig>({
    enabled: false,
    secretMappings: {},
  });
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Load initial state
  useEffect(() => {
    loadKeeperState();
  }, []);

  async function loadKeeperState() {
    setIsLoading(true);
    try {
      const [keeperStatus, keeperConfig] = await Promise.all([
        getKeeperStatus(),
        getKeeperConfig(),
      ]);

      setStatus(keeperStatus);
      setConfig(keeperConfig);

      if (keeperStatus.connected) {
        const secretsResult = await listKeeperSecrets();
        setSecrets(secretsResult.secrets);
      }
    } catch (error) {
      logger.error("Failed to load Keeper state", { error });
      setMessage({
        type: "error",
        text: "Failed to load Keeper configuration",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConnect() {
    if (!token.trim()) {
      setMessage({ type: "error", text: "Please enter a one-time access token" });
      return;
    }

    setIsConnecting(true);
    setMessage(null);

    try {
      const result = await initializeKeeper(token.trim());

      if (result.success) {
        setToken(""); // Clear token after successful connection
        setMessage({ type: "success", text: result.message });

        // Reload state
        const [keeperStatus, secretsResult] = await Promise.all([
          getKeeperStatus(),
          listKeeperSecrets(),
        ]);

        setStatus(keeperStatus);
        setSecrets(secretsResult.secrets);

        // Enable Keeper by default after connecting
        const newConfig = { ...config, enabled: true };
        setConfig(newConfig);
        await saveKeeperConfig(newConfig);

        onConfigChange?.();
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch (error: any) {
      logger.error("Failed to connect to Keeper", { error });
      setMessage({
        type: "error",
        text: error?.message || "Failed to connect to Keeper",
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Are you sure you want to disconnect from Keeper? You will need a new one-time token to reconnect."
      )
    ) {
      return;
    }

    try {
      await disconnectKeeper();
      setStatus({
        configured: false,
        connected: false,
        secrets_count: 0,
        message: "",
      });
      setSecrets([]);
      setConfig({ enabled: false, secretMappings: {} });
      setMessage({ type: "success", text: "Disconnected from Keeper" });
      onConfigChange?.();
    } catch (error: any) {
      setMessage({
        type: "error",
        text: error?.message || "Failed to disconnect",
      });
    }
  }

  async function handleToggleEnabled() {
    const newConfig = { ...config, enabled: !config.enabled };
    try {
      await saveKeeperConfig(newConfig);
      setConfig(newConfig);
      onConfigChange?.();
    } catch (error: any) {
      logger.error("Failed to toggle Keeper", { error });
      setMessage({
        type: "error",
        text: error?.message || "Failed to save configuration",
      });
    }
  }

  async function handleMapSecret(
    provider: "openai" | "anthropic" | "zai",
    secretUid: string
  ) {
    const newConfig = {
      ...config,
      secretMappings: {
        ...config.secretMappings,
        [provider]: secretUid || undefined,
      },
    };

    // Remove empty mappings
    if (!secretUid) {
      delete newConfig.secretMappings[provider];
    }

    try {
      await saveKeeperConfig(newConfig);
      setConfig(newConfig);
      onConfigChange?.();
    } catch (error: any) {
      logger.error("Failed to map secret", { error, provider });
      setMessage({
        type: "error",
        text: error?.message || "Failed to save secret mapping",
      });
    }
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
          <span className="text-gray-400">Loading Keeper configuration...</span>
        </div>
      </div>
    );
  }

  const isConnected = status?.connected ?? false;

  return (
    <div className="space-y-4 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-purple-400" />
          <div>
            <h3 className="font-semibold text-purple-300">
              Keeper Secrets Manager
            </h3>
            <p className="text-xs text-gray-400">
              Securely retrieve API keys from your organization's vault
            </p>
          </div>
        </div>

        {isConnected && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={handleToggleEnabled}
                className="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-purple-500"
              />
              Enable
            </label>
          </div>
        )}
      </div>

      {/* Connection Status */}
      <div
        className={`p-3 rounded-lg ${
          isConnected
            ? "bg-green-500/10 border border-green-500/20"
            : "bg-gray-900/50 border border-gray-700"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-400" : "bg-gray-500"
              }`}
            />
            <span
              className={`text-sm ${
                isConnected ? "text-green-400" : "text-gray-400"
              }`}
            >
              {isConnected
                ? `Connected (${status?.secrets_count ?? 0} secrets available)`
                : "Not connected"}
            </span>
          </div>

          {isConnected && (
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-400 hover:text-red-300 transition"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Connect Form (when not connected) */}
      {!isConnected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              One-Time Access Token
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  placeholder="Paste your Keeper one-time token"
                  disabled={isConnecting}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-purple-500 disabled:opacity-50"
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
              <button
                onClick={handleConnect}
                disabled={isConnecting || !token.trim()}
                className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center gap-2"
              >
                {isConnecting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Key className="w-4 h-4" />
                )}
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>

          {/* Help Text */}
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-400">
              <p className="mb-1">
                Get a one-time token from your Keeper administrator, or generate
                one yourself:
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>Open the Keeper Web Vault</li>
                <li>Go to Settings → Secrets Manager → Applications</li>
                <li>Select your application or create a new one</li>
                <li>Click "Add Device" to generate a new token</li>
              </ol>
              <a
                href="https://docs.keeper.io/en/keeperpam/secrets-manager/about/one-time-token"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-purple-400 hover:underline mt-2"
              >
                Learn more about Keeper Secrets Manager
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Secret Mappings (when connected and enabled) */}
      {isConnected && config.enabled && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-gray-400">
            Map Secrets to AI Providers
          </label>

          {(["openai", "anthropic", "zai"] as const).map((provider) => {
            const currentMapping = config.secretMappings[provider];
            const isMapped = !!currentMapping;

            return (
              <div key={provider} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-300 capitalize">
                  {provider === "zai" ? "Z.ai" : provider}
                </span>
                <select
                  value={currentMapping || ""}
                  onChange={(e) =>
                    handleMapSecret(provider, e.target.value)
                  }
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="">-- Select a secret --</option>
                  {secrets.map((secret) => (
                    <option key={secret.uid} value={secret.uid}>
                      {secret.title}
                    </option>
                  ))}
                </select>
                <div className="w-6 flex justify-center">
                  {isMapped ? (
                    <Link className="w-4 h-4 text-green-400" title="Linked" />
                  ) : (
                    <Unlink className="w-4 h-4 text-gray-500" title="Not linked" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Security Note */}
          <div className="flex items-start gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-700 mt-4">
            <Shield className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              API keys are retrieved securely from Keeper at runtime. Keys are
              never stored locally or displayed in this application.
            </p>
          </div>
        </div>
      )}

      {/* Connected but disabled message */}
      {isConnected && !config.enabled && (
        <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-yellow-400">
              Keeper is connected but disabled. Enable it above to use secrets
              from your vault.
            </span>
          </div>
        </div>
      )}

      {/* Status Message */}
      {message && (
        <div
          className={`p-3 rounded-lg flex items-center justify-between ${
            message.type === "success"
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : message.type === "error"
              ? "bg-red-500/10 border border-red-500/20 text-red-400"
              : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === "success" && <Check className="w-4 h-4" />}
            {message.type === "error" && <AlertTriangle className="w-4 h-4" />}
            {message.type === "info" && <Info className="w-4 h-4" />}
            <span className="text-sm">{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="p-1 hover:bg-white/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
