import { useState, useEffect } from "react";
import { getStoredProvider, getStoredModel } from "../services/api";
import { getApiKey } from "../services/secure-storage";
import { getKeeperConfig, getKeeperStatus, isProviderMappedInConfig } from "../services/keeper";
import { getCodexMgXConfig } from "../services/codexmgx";
import { isJiraEnabled } from "../services/jira";
import { isSentryEnabled } from "../services/sentry";
import { STORAGE_KEYS } from "../utils/config";
import { CURATED_MODELS } from "../constants/providers";

// ── Types ──────────────────────────────────────────────────────────────────

export type DimensionState = "ok" | "warning" | "not-configured" | "disabled";

export interface DimensionStatus {
  state: DimensionState;
  label: string;
  detail: string;
  settingsSection: string;
}

export interface ReadinessStatus {
  overall: "ready" | "warning" | "not-configured";
  ai: DimensionStatus;
  keeper: DimensionStatus;
  mcp: DimensionStatus;
  jira: DimensionStatus;
  sentry: DimensionStatus;
}

export interface ReadinessInput {
  provider: string;
  model: string;
  apiKeyPresent: boolean;
  keeperEnabled: boolean;
  keeperConnected: boolean;
  keeperActiveForProvider: boolean;
  mcpEnabled: boolean;
  jiraEnabled: boolean;
  jiraConnectionOk: boolean | null;
  sentryEnabled: boolean;
  sentryConnectionOk: boolean | null;
}

// ── Pure compute (exported for testing) ───────────────────────────────────

export function computeReadinessStatus(input: ReadinessInput): ReadinessStatus {
  const {
    provider, model, apiKeyPresent,
    keeperEnabled, keeperConnected, keeperActiveForProvider,
    mcpEnabled,
    jiraEnabled, jiraConnectionOk,
    sentryEnabled, sentryConnectionOk,
  } = input;

  // AI dimension
  const hasKey = apiKeyPresent || keeperActiveForProvider;
  const curatedModels = CURATED_MODELS[provider] ?? [];
  const modelInfo = curatedModels.find((m) => m.id === model);
  const modelSuitable = !modelInfo || modelInfo.suitableForHadron !== false;

  let aiState: DimensionState = "ok";
  let aiDetail = `${provider} · ${model} · key present`;
  if (!hasKey) {
    aiState = "not-configured";
    aiDetail = "No API key configured. Add one in Settings → AI.";
  } else if (!modelSuitable) {
    aiState = "warning";
    aiDetail = `${model} is not recommended for Hadron. Consider switching to a supported model.`;
  }
  const ai: DimensionStatus = {
    state: aiState,
    label: hasKey ? `${provider} · ${model}` : "No API key",
    detail: aiDetail,
    settingsSection: "ai-provider",
  };

  // Keeper dimension
  let keeper: DimensionStatus;
  if (!keeperEnabled) {
    keeper = { state: "disabled", label: "Keeper off", detail: "Keeper Secrets Manager is not enabled.", settingsSection: "keeper" };
  } else if (!keeperConnected) {
    keeper = { state: "warning", label: "Keeper error", detail: "Keeper is enabled but could not connect. Check your token in Settings → Secrets.", settingsSection: "keeper" };
  } else {
    keeper = { state: "ok", label: "Keeper", detail: "Keeper Secrets Manager is connected.", settingsSection: "keeper" };
  }

  // MCP dimension
  let mcp: DimensionStatus;
  if (!mcpEnabled) {
    mcp = { state: "disabled", label: "MCP off", detail: "CodexMgX MCP is not enabled.", settingsSection: "mcp" };
  } else {
    mcp = { state: "ok", label: "MCP", detail: "CodexMgX MCP is enabled.", settingsSection: "mcp" };
  }

  // JIRA dimension
  let jira: DimensionStatus;
  if (!jiraEnabled) {
    jira = { state: "disabled", label: "JIRA off", detail: "JIRA integration is not configured.", settingsSection: "jira" };
  } else if (jiraConnectionOk === false) {
    jira = { state: "warning", label: "JIRA error", detail: "JIRA is configured but the last connection test failed. Check credentials in Settings → Integrations.", settingsSection: "jira" };
  } else {
    jira = { state: "ok", label: "JIRA", detail: "JIRA integration is connected.", settingsSection: "jira" };
  }

  // Sentry dimension
  let sentry: DimensionStatus;
  if (!sentryEnabled) {
    sentry = { state: "disabled", label: "Sentry off", detail: "Sentry integration is not configured.", settingsSection: "sentry" };
  } else if (sentryConnectionOk === false) {
    sentry = { state: "warning", label: "Sentry error", detail: "Sentry is configured but the last connection test failed. Check credentials in Settings → Integrations.", settingsSection: "sentry" };
  } else {
    sentry = { state: "ok", label: "Sentry", detail: "Sentry integration is connected.", settingsSection: "sentry" };
  }

  // Overall: ignore disabled dimensions
  const active = [ai, keeper, mcp, jira, sentry].filter((d) => d.state !== "disabled");
  let overall: ReadinessStatus["overall"] = "ready";
  if (active.some((d) => d.state === "not-configured")) overall = "not-configured";
  else if (active.some((d) => d.state === "warning")) overall = "warning";

  return { overall, ai, keeper, mcp, jira, sentry };
}

// ── Hook ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;

export function useReadinessStatus(): ReadinessStatus {
  const [status, setStatus] = useState<ReadinessStatus>(() =>
    computeReadinessStatus({
      provider: getStoredProvider(),
      model: getStoredModel(),
      apiKeyPresent: false,
      keeperEnabled: false,
      keeperConnected: false,
      keeperActiveForProvider: false,
      mcpEnabled: false,
      jiraEnabled: false,
      jiraConnectionOk: null,
      sentryEnabled: false,
      sentryConnectionOk: null,
    })
  );

  useEffect(() => {
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      const provider = getStoredProvider();
      const model = getStoredModel();
      const [apiKey, keeperCfg, keeperSt, mcpCfg, jiraOn, sentryOn] = await Promise.all([
        getApiKey(provider),
        getKeeperConfig(),
        getKeeperStatus().catch(() => null),
        getCodexMgXConfig(),
        isJiraEnabled(),
        isSentryEnabled(),
      ]);

      const keeperActiveForProvider = isProviderMappedInConfig(keeperCfg, provider);

      const jiraConnOkRaw = localStorage.getItem(STORAGE_KEYS.JIRA_CONNECTION_OK);
      const sentryConnOkRaw = localStorage.getItem(STORAGE_KEYS.SENTRY_CONNECTION_OK);

      setStatus(
        computeReadinessStatus({
          provider,
          model,
          apiKeyPresent: !!apiKey,
          keeperEnabled: keeperCfg.enabled,
          keeperConnected: !!keeperSt?.connected,
          keeperActiveForProvider,
          mcpEnabled: mcpCfg.enabled,
          jiraEnabled: jiraOn,
          jiraConnectionOk: jiraConnOkRaw === null ? null : jiraConnOkRaw === "true",
          sentryEnabled: sentryOn,
          sentryConnectionOk: sentryConnOkRaw === null ? null : sentryConnOkRaw === "true",
        })
      );
    }

    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    // Re-run immediately when the window regains focus so the bar is current.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return status;
}
