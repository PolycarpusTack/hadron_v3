import { describe, it, expect, vi } from "vitest";

// Mock service imports so the module loads cleanly in Node environment
vi.mock("../src/services/api", () => ({ getStoredProvider: () => "openai", getStoredModel: () => "gpt-5.4-mini" }));
vi.mock("../src/services/secure-storage", () => ({ getApiKey: vi.fn(), getSetting: vi.fn(), storeSetting: vi.fn() }));
vi.mock("../src/services/keeper", () => ({ getKeeperConfig: vi.fn(), getKeeperStatus: vi.fn() }));
vi.mock("../src/services/codexmgx", () => ({ getCodexMgXConfig: vi.fn() }));
vi.mock("../src/services/jira", () => ({ isJiraEnabled: vi.fn() }));
vi.mock("../src/services/sentry", () => ({ isSentryEnabled: vi.fn() }));
vi.mock("../src/lib/tauri-core-shim", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/logger", () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../src/constants/providers", () => ({
  CURATED_MODELS: {
    openai: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", context: 400000, suitableForHadron: true },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", context: 128000, suitableForHadron: false },
    ],
  },
}));

import { computeReadinessStatus } from "../src/hooks/useReadinessStatus";
import type { ReadinessInput } from "../src/hooks/useReadinessStatus";

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKeyPresent: true,
    keeperEnabled: false,
    keeperConnected: false,
    keeperActiveForProvider: false,
    mcpEnabled: false,
    jiraEnabled: false,
    jiraConnectionOk: null,
    sentryEnabled: false,
    sentryConnectionOk: null,
    ...overrides,
  };
}

describe("computeReadinessStatus", () => {
  it("returns overall=ready when provider+key configured and integrations disabled", () => {
    const status = computeReadinessStatus(baseInput());
    expect(status.overall).toBe("ready");
    expect(status.ai.state).toBe("ok");
  });

  it("returns ai=not-configured when no api key and keeper not active", () => {
    const status = computeReadinessStatus(baseInput({ apiKeyPresent: false }));
    expect(status.ai.state).toBe("not-configured");
    expect(status.overall).toBe("not-configured");
  });

  it("returns ai=ok when no manual key but keeper is active for provider", () => {
    const status = computeReadinessStatus(
      baseInput({ apiKeyPresent: false, keeperEnabled: true, keeperConnected: true, keeperActiveForProvider: true })
    );
    expect(status.ai.state).toBe("ok");
  });

  it("returns keeper=disabled when keeper not enabled", () => {
    const status = computeReadinessStatus(baseInput({ keeperEnabled: false }));
    expect(status.keeper.state).toBe("disabled");
  });

  it("returns keeper=warning when enabled but not connected", () => {
    const status = computeReadinessStatus(baseInput({ keeperEnabled: true, keeperConnected: false }));
    expect(status.keeper.state).toBe("warning");
  });

  it("returns jira=disabled when jira not enabled", () => {
    const status = computeReadinessStatus(baseInput({ jiraEnabled: false }));
    expect(status.jira.state).toBe("disabled");
  });

  it("returns jira=ok when enabled and connection ok is null (never tested)", () => {
    const status = computeReadinessStatus(baseInput({ jiraEnabled: true, jiraConnectionOk: null }));
    expect(status.jira.state).toBe("ok");
  });

  it("returns jira=warning when enabled but last connection test failed", () => {
    const status = computeReadinessStatus(baseInput({ jiraEnabled: true, jiraConnectionOk: false }));
    expect(status.jira.state).toBe("warning");
    expect(status.overall).toBe("warning");
  });

  it("overall=warning beats overall=ready but loses to not-configured", () => {
    const status = computeReadinessStatus(
      baseInput({ jiraEnabled: true, jiraConnectionOk: false })
    );
    expect(status.overall).toBe("warning");
  });

  it("returns ai=warning when model has suitableForHadron: false", () => {
    const status = computeReadinessStatus(baseInput({ model: "gpt-4o-mini" }));
    expect(status.ai.state).toBe("warning");
    expect(status.overall).toBe("warning");
  });
});
