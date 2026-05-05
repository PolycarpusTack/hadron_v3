# Trust & Readiness (Cluster A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slim AI readiness status bar to the app header, a grouped model picker, and a post-load file-size fit warning — all fed by a single `useReadinessStatus` hook.

**Architecture:** A new `useReadinessStatus` hook polls all readiness signals every 5 s and returns a typed `ReadinessStatus` object. `AppHeader` consumes it to render a slim dot-strip. `FileDropZone` uses a new `getModelSafeLimit` utility to warn after file load. `ModelPicker` replaces native `<select>` elements for model selection with grouped sections.

**Tech Stack:** React 18, TypeScript, Vitest (node env), Tailwind / CSS vars (existing `hd-*` classes), Lucide icons, existing services (`keeper.ts`, `codexmgx.ts`, `jira.ts`, `sentry.ts`, `api.ts`).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/model-fit.ts` | Create | Maps provider+model → safe byte limit |
| `src/hooks/useReadinessStatus.ts` | Create | Central readiness hook + types |
| `src/components/ui/StatusPopover.tsx` | Create | Dot-click popover with "Fix this →" |
| `src/components/ui/ModelPicker.tsx` | Create | Grouped model dropdown |
| `src/components/AppHeader.tsx` | Modify | Replace status pill → slim status bar |
| `src/components/FileDropZone.tsx` | Modify | Post-load fit warning + copy fix |
| `src/components/SettingsPanel.tsx` | Modify | Replace model `<select>` with `ModelPicker` |
| `src/App.tsx` | Modify | Pass `readinessStatus` prop, fix error strings |
| `src/components/ApiKeyWarning.tsx` | Delete | Superseded by status bar |
| `src/utils/config.ts` | Modify | Add `JIRA_CONNECTION_OK`, `SENTRY_CONNECTION_OK` keys |
| `tests/model-fit.test.ts` | Create | Unit tests for safe-limit utility |
| `tests/readiness-status.test.ts` | Create | Unit tests for pure readiness compute function |

---

## Task 1: `model-fit.ts` utility

**Files:**
- Create: `src/utils/model-fit.ts`
- Create: `tests/model-fit.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `tests/model-fit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getModelSafeLimit } from "../src/utils/model-fit";

describe("getModelSafeLimit", () => {
  it("returns correct limit for GPT-5.4 Mini (400K ctx)", () => {
    // 400_000 tokens × 4 bytes × 0.7 safety = 1_120_000
    expect(getModelSafeLimit("openai", "gpt-5.4-mini")).toBe(1_120_000);
  });

  it("returns correct limit for Claude Sonnet 4 (200K ctx)", () => {
    // 200_000 × 4 × 0.7 = 560_000
    expect(getModelSafeLimit("anthropic", "claude-sonnet-4-0")).toBe(560_000);
  });

  it("returns fallback 512_000 for unknown model", () => {
    expect(getModelSafeLimit("openai", "gpt-unknown-future")).toBe(512_000);
  });

  it("returns fallback 512_000 for unknown provider", () => {
    expect(getModelSafeLimit("unknownprovider", "some-model")).toBe(512_000);
  });

  it("returns fallback for local providers with context=0", () => {
    // llamacpp default has context: 0 → fallback
    expect(getModelSafeLimit("llamacpp", "default")).toBe(512_000);
  });
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm test -- tests/model-fit.test.ts
```

Expected: `FAIL` — `Cannot find module '../src/utils/model-fit'`

- [ ] **Step 1.3: Implement `model-fit.ts`**

Create `src/utils/model-fit.ts`:

```ts
import { CURATED_MODELS } from "../constants/providers";

const BYTES_PER_TOKEN = 4;
const SAFETY_FACTOR = 0.7;
const FALLBACK_BYTES = 512_000;

export function getModelSafeLimit(provider: string, modelId: string): number {
  const models = CURATED_MODELS[provider];
  if (!models) return FALLBACK_BYTES;
  const model = models.find((m) => m.id === modelId);
  if (!model || !model.context) return FALLBACK_BYTES;
  return Math.floor(model.context * BYTES_PER_TOKEN * SAFETY_FACTOR);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npm test -- tests/model-fit.test.ts
```

Expected: `5 passed`

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/model-fit.ts tests/model-fit.test.ts
git commit -m "feat(model-fit): add getModelSafeLimit utility"
```

---

## Task 2: Storage keys + `useReadinessStatus` hook

**Files:**
- Modify: `src/utils/config.ts`
- Create: `src/hooks/useReadinessStatus.ts`
- Create: `tests/readiness-status.test.ts`

- [ ] **Step 2.1: Add storage keys to `config.ts`**

In `src/utils/config.ts`, add two keys to the `STORAGE_KEYS` object after the Sentry block:

```ts
  // Readiness signals (written by integration settings on successful connection test)
  JIRA_CONNECTION_OK: "jira_connection_ok",
  SENTRY_CONNECTION_OK: "sentry_connection_ok",
```

- [ ] **Step 2.2: Write failing tests for the pure compute function**

Create `tests/readiness-status.test.ts`:

```ts
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
});
```

- [ ] **Step 2.3: Run tests to confirm they fail**

```bash
npm test -- tests/readiness-status.test.ts
```

Expected: `FAIL` — `Cannot find module '../src/hooks/useReadinessStatus'`

- [ ] **Step 2.4: Implement `useReadinessStatus.ts`**

Create `src/hooks/useReadinessStatus.ts`:

```ts
import { useState, useEffect } from "react";
import { getStoredProvider, getStoredModel } from "../services/api";
import { getApiKey } from "../services/secure-storage";
import { getKeeperConfig, getKeeperStatus } from "../services/keeper";
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
    settingsSection: "ai",
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

      const keeperActiveForProvider =
        keeperCfg.enabled &&
        !!keeperCfg.secretMappings[provider as keyof typeof keeperCfg.secretMappings];

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
    return () => clearInterval(id);
  }, []);

  return status;
}
```

- [ ] **Step 2.5: Run tests to confirm they pass**

```bash
npm test -- tests/readiness-status.test.ts
```

Expected: `9 passed`

- [ ] **Step 2.6: Commit**

```bash
git add src/utils/config.ts src/hooks/useReadinessStatus.ts tests/readiness-status.test.ts
git commit -m "feat(readiness): add useReadinessStatus hook and computeReadinessStatus"
```

---

## Task 3: `StatusPopover` component

**Files:**
- Create: `src/components/ui/StatusPopover.tsx`

- [ ] **Step 3.1: Implement `StatusPopover.tsx`**

Create `src/components/ui/StatusPopover.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import type { DimensionStatus } from "../../hooks/useReadinessStatus";

interface StatusPopoverProps {
  dimension: DimensionStatus;
  onOpenSettings: (section: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
}

export default function StatusPopover({ dimension, onOpenSettings, onClose, anchorRef }: StatusPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, anchorRef]);

  const needsAction = dimension.state === "warning" || dimension.state === "not-configured";

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 rounded-lg shadow-xl p-3"
      style={{
        background: "var(--hd-bg-elevated, #0f1929)",
        border: "1px solid var(--hd-border)",
      }}
    >
      <p className="text-xs mb-2" style={{ color: "var(--hd-text-muted)" }}>
        {dimension.detail}
      </p>
      {needsAction && (
        <button
          onClick={() => { onOpenSettings(dimension.settingsSection); onClose(); }}
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: "var(--hd-accent)" }}
        >
          <ExternalLink className="w-3 h-3" />
          Fix this →
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/components/ui/StatusPopover.tsx
git commit -m "feat(ui): add StatusPopover component"
```

---

## Task 4: `ModelPicker` component

**Files:**
- Create: `src/components/ui/ModelPicker.tsx`

- [ ] **Step 4.1: Implement `ModelPicker.tsx`**

Create `src/components/ui/ModelPicker.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { CURATED_MODELS } from "../../constants/providers";

export interface ModelOption {
  id: string;
  label: string;
  context?: number;
  suitableForHadron?: boolean;
  category?: string;
}

interface ModelPickerProps {
  provider: string;
  value: string;
  models: ModelOption[];
  onChange: (modelId: string) => void;
  className?: string;
}

function formatCtx(tokens: number): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

export default function ModelPicker({ provider, value, models, onChange, className = "" }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Merge curated data (for suitableForHadron + context) with passed models list
  const curated = CURATED_MODELS[provider] ?? [];
  const enriched: ModelOption[] = models.map((m) => {
    const c = curated.find((c) => c.id === m.id);
    return { ...m, suitableForHadron: c?.suitableForHadron, context: m.context ?? c?.context };
  });

  const recommended = enriched.filter((m) => m.suitableForHadron !== false && (m.context ?? 0) > 0);
  const mayTruncate = enriched.filter((m) => m.suitableForHadron === false || (m.context !== undefined && m.context > 0 && m.context < 200_000));
  const local = enriched.filter((m) => !m.context || m.context === 0);

  const selected = enriched.find((m) => m.id === value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-left"
        style={{ background: "var(--hd-bg)", border: "1px solid var(--hd-border)", color: "var(--hd-text)" }}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--hd-text-muted)" }} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg shadow-xl overflow-hidden"
          style={{ background: "var(--hd-bg-elevated, #080f1d)", border: "1px solid var(--hd-border)" }}
        >
          {recommended.length > 0 && (
            <>
              <div className="px-3 py-1.5" style={{ background: "rgba(0,0,0,0.3)", borderBottom: "1px solid var(--hd-border-subtle)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--hd-accent)" }}>
                  Recommended for Hadron
                </span>
              </div>
              {recommended.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} />
              ))}
            </>
          )}
          {mayTruncate.length > 0 && (
            <>
              <div className="px-3 py-1.5" style={{ background: "rgba(239,68,68,0.06)", borderTop: "1px solid var(--hd-border-subtle)", borderBottom: "1px solid var(--hd-border-subtle)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                  ⚠ May truncate your logs
                </span>
              </div>
              {mayTruncate.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} muted />
              ))}
            </>
          )}
          {local.length > 0 && (
            <>
              <div className="px-3 py-1.5" style={{ background: "rgba(0,0,0,0.2)", borderTop: "1px solid var(--hd-border-subtle)", borderBottom: "1px solid var(--hd-border-subtle)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--hd-text-dim)" }}>
                  Local
                </span>
              </div>
              {local.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} muted />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModelRow({ model, selected, onSelect, muted = false }: { model: ModelOption; selected: boolean; onSelect: (id: string) => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors"
      style={{ color: muted ? "var(--hd-text-dim)" : "var(--hd-text-muted)" }}
    >
      <span className="flex items-center gap-2">
        {selected && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
        {!selected && <span className="w-3 h-3 flex-shrink-0" />}
        <span className="truncate">{model.label}</span>
      </span>
      {model.context ? (
        <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "var(--hd-text-dim)" }}>
          {formatCtx(model.context)}
        </span>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add src/components/ui/ModelPicker.tsx
git commit -m "feat(ui): add ModelPicker component with grouped sections"
```

---

## Task 5: Update `AppHeader` — slim status bar

**Files:**
- Modify: `src/components/AppHeader.tsx`

The current `AppHeader` (117 lines) receives `providerName`, `jiraConnected`, `sentryConnected`. Replace these three props with a single `readinessStatus: ReadinessStatus` prop.

- [ ] **Step 5.1: Rewrite `AppHeader.tsx`**

Replace the full contents of `src/components/AppHeader.tsx`:

```tsx
import { useRef, useState } from "react";
import { Settings, MessageCircle, BarChart3 } from "lucide-react";
import { APP_VERSION } from "../constants/version";
import type { ReadinessStatus, DimensionStatus } from "../hooks/useReadinessStatus";
import StatusPopover from "./ui/StatusPopover";

interface AppHeaderProps {
  readinessStatus: ReadinessStatus;
  onOpenSettings?: (section?: string) => void;
  onOpenAskHadronDrawer?: () => void;
  onOpenDashboard?: () => void;
  isSettingsActive?: boolean;
}

const STATE_COLORS: Record<string, string> = {
  ok: "var(--hd-accent)",
  warning: "#f59e0b",
  "not-configured": "#ef4444",
  disabled: "var(--hd-text-dim)",
};

const OVERALL_LABEL: Record<string, string> = {
  ready: "Ready",
  warning: "Needs attention",
  "not-configured": "Needs setup",
};

export default function AppHeader({
  readinessStatus,
  onOpenSettings,
  onOpenAskHadronDrawer,
  onOpenDashboard,
  isSettingsActive,
}: AppHeaderProps) {
  const [openPopover, setOpenPopover] = useState<keyof ReadinessStatus | null>(null);
  const dotRefs = useRef<Partial<Record<keyof ReadinessStatus, HTMLButtonElement>>>({});

  const dimensions: [keyof ReadinessStatus, DimensionStatus][] = [
    ["ai", readinessStatus.ai],
    ["keeper", readinessStatus.keeper],
    ["mcp", readinessStatus.mcp],
    ["jira", readinessStatus.jira],
    ["sentry", readinessStatus.sentry],
  ];

  return (
    <header className="hd-panel mb-0 px-4 pt-3 pb-2">
      {/* Top row: logo + buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-3">
          <img
            src="/elena-button.png"
            alt="Hadron"
            className="h-10 w-10 rounded-[10px] object-cover"
            style={{ boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--hd-text)", letterSpacing: "-0.02em" }}>
              Hadron
            </h1>
            <p className="text-xs" style={{ color: "var(--hd-text-muted)", marginTop: "1px" }}>
              AI Support Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="rounded-md px-2 py-0.5 text-[0.7rem] font-mono" style={{ border: "1px solid var(--hd-border-subtle)", color: "var(--hd-text-dim)" }}>
            v{APP_VERSION}
          </span>
          {onOpenAskHadronDrawer && (
            <button onClick={onOpenAskHadronDrawer} className="hd-header-icon-btn" title="Ask Hadron" aria-label="Open Ask Hadron drawer">
              <MessageCircle className="w-4 h-4" />
            </button>
          )}
          {onOpenDashboard && (
            <button onClick={onOpenDashboard} className="hd-header-icon-btn" title="Intelligence Dashboard" aria-label="Open Intelligence Dashboard">
              <BarChart3 className="w-4 h-4" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={() => onOpenSettings()}
              className={`hd-header-icon-btn ${isSettingsActive ? "hd-header-icon-btn-active" : ""}`}
              title="Settings"
              aria-label="Open settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-0 flex-wrap" style={{ borderTop: "1px solid var(--hd-border-subtle)", paddingTop: "6px" }}>
        {dimensions.map(([key, dim], idx) => {
          const dotRef = (el: HTMLButtonElement | null) => {
            if (el) dotRefs.current[key] = el;
          };
          const isOpen = openPopover === key;

          return (
            <span key={key} className="relative flex items-center">
              {idx > 0 && <span className="mx-2 text-xs" style={{ color: "var(--hd-border)" }}>|</span>}
              <button
                ref={dotRef}
                onClick={() => setOpenPopover(isOpen ? null : key)}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                title={dim.label}
                aria-label={`${key} status: ${dim.state}`}
              >
                <span
                  className="rounded-full flex-shrink-0"
                  style={{
                    width: 7,
                    height: 7,
                    background: STATE_COLORS[dim.state] ?? STATE_COLORS.disabled,
                    boxShadow: dim.state === "ok" ? `0 0 5px ${STATE_COLORS.ok}` : undefined,
                  }}
                />
                <span className="text-[10px]" style={{ color: "var(--hd-text-dim)" }}>
                  {dim.label}
                </span>
              </button>
              {isOpen && (
                <StatusPopover
                  dimension={dim}
                  onOpenSettings={(section) => onOpenSettings?.(section)}
                  onClose={() => setOpenPopover(null)}
                  anchorRef={{ current: dotRefs.current[key] ?? null }}
                />
              )}
            </span>
          );
        })}

        <span className="ml-auto">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px]"
            style={{
              background: readinessStatus.overall === "ready" ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${readinessStatus.overall === "ready" ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
              color: readinessStatus.overall === "ready" ? "var(--hd-accent)" : "#f59e0b",
            }}
          >
            {OVERALL_LABEL[readinessStatus.overall]}
          </span>
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "feat(header): replace status pill with slim readiness status bar"
```

---

## Task 6: Update `FileDropZone` — fit warning + copy fix

**Files:**
- Modify: `src/components/FileDropZone.tsx`

- [ ] **Step 6.1: Fix the static copy and add fit warning**

In `src/components/FileDropZone.tsx`, make three changes:

**Change 1** — Fix static copy (around line 312). Find and replace:

```tsx
// OLD
<p className="text-xs mb-5" style={{ color: 'var(--hd-text-dim)' }}>
  Supports .txt and .log files up to 5MB
</p>
```

```tsx
// NEW
<p className="text-xs mb-5" style={{ color: 'var(--hd-text-dim)' }}>
  Recommended under 1MB · .txt and .log files
</p>
```

**Change 2** — Add imports at the top of the file (after existing imports):

```tsx
import { getModelSafeLimit, formatBytes } from "../utils/model-fit";
import { CURATED_MODELS } from "../constants/providers";
```

**Change 3** — Add fit-warning state and computation. Find the section where `selectedFile` / file info state is managed. Add a `fitWarning` state and compute it when a file is selected. Locate the `handleFileSelect` callback (or wherever `file` is set after selection) and add after the file size is known:

```tsx
// Inside the component, add near other state declarations:
const [fitWarning, setFitWarning] = useState<{ fileBytes: number; limitBytes: number; suggestedModel: string } | null>(null);

// In the file-selection handler, after you have file size:
const limit = getModelSafeLimit(provider, model);
if (fileBytes > limit) {
  const curatedForProvider = CURATED_MODELS[provider] ?? [];
  const best = curatedForProvider
    .filter((m) => m.suitableForHadron !== false && m.context > 0)
    .sort((a, b) => b.context - a.context)[0];
  setFitWarning({ fileBytes, limitBytes: limit, suggestedModel: best?.label ?? "a larger-context model" });
} else {
  setFitWarning(null);
}
```

**Change 4** — Render the warning inside the drop zone, below the file info and above the controls row:

```tsx
{fitWarning && (
  <div
    className="mb-3 rounded-lg p-3"
    style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
  >
    <p className="text-xs font-semibold mb-1" style={{ color: "#f59e0b" }}>
      ⚠ File may be truncated
    </p>
    <p className="text-xs" style={{ color: "var(--hd-text-muted)" }}>
      Current model handles ~{formatBytes(fitWarning.limitBytes)}. This file ({formatBytes(fitWarning.fileBytes)}) may be cut off.
      Consider switching to {fitWarning.suggestedModel} for full analysis.
    </p>
  </div>
)}
```

Also reset `fitWarning` to `null` whenever the file is cleared.

- [ ] **Step 6.2: Commit**

```bash
git add src/components/FileDropZone.tsx
git commit -m "feat(dropzone): add post-load file fit warning and fix size copy"
```

---

## Task 7: Update `SettingsPanel` — use `ModelPicker`

**Files:**
- Modify: `src/components/SettingsPanel.tsx`

- [ ] **Step 7.1: Add `ModelPicker` import**

Near the top of `src/components/SettingsPanel.tsx`, add to the imports block:

```tsx
import ModelPicker from "./ui/ModelPicker";
```

- [ ] **Step 7.2: Replace model `<select>` with `ModelPicker`**

In `SettingsPanel.tsx`, find the model selection `<select>` element inside the Advanced section (it renders `availableModels` as `<option>` elements). Replace the entire `<select>...</select>` block with:

```tsx
<ModelPicker
  provider={settings.provider}
  value={settings.model === "custom" ? settings.customModel : settings.model}
  models={availableModels}
  onChange={(id) => {
    setSettings((prev) => ({ ...prev, model: id, customModel: "" }));
    localStorage.setItem(providerModelKey(settings.provider), id);
  }}
/>
```

- [ ] **Step 7.3: Commit**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "feat(settings): replace model select with ModelPicker"
```

---

## Task 8: Update `App.tsx` — wire readiness + fix error strings

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 8.1: Add `useReadinessStatus` import and usage**

In `src/App.tsx`, add the import near other hook imports:

```tsx
import { useReadinessStatus } from "./hooks/useReadinessStatus";
```

Inside the component body (near the top, after existing hooks), add:

```tsx
const readinessStatus = useReadinessStatus();
```

- [ ] **Step 8.2: Update `AppHeader` usage**

Find the `<AppHeader ... />` JSX in `App.tsx` (around line 636). Replace the old props:

```tsx
// OLD
<AppHeader
  providerName={getStoredProvider()}
  jiraConnected={jiraConnected}
  sentryConnected={sentryConnected}
  onOpenSettings={...}
  ...
/>
```

```tsx
// NEW
<AppHeader
  readinessStatus={readinessStatus}
  onOpenSettings={(section) => {
    setCurrentView("configure");
    // section is available for future deep-link use
  }}
  onOpenAskHadronDrawer={onOpenAskHadronDrawer}
  onOpenDashboard={onOpenDashboard}
  isSettingsActive={currentView === "configure"}
/>
```

Remove any now-unused `jiraConnected`, `sentryConnected`, or `providerName` state/props that were only used to feed `AppHeader`.

- [ ] **Step 8.3: Fix OpenAI-specific error strings**

At line 435 and line 501, change:

```tsx
// OLD (both lines)
throw new Error("Please set your OpenAI API key in Settings");
```

```tsx
// NEW (both lines)
throw new Error("Please configure an API key in Settings");
```

- [ ] **Step 8.4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): wire useReadinessStatus to AppHeader, fix error strings"
```

---

## Task 9: Delete `ApiKeyWarning.tsx` and remove its usages

**Files:**
- Delete: `src/components/ApiKeyWarning.tsx`
- Modify: any file that imports `ApiKeyWarning`

- [ ] **Step 9.1: Find all usages**

```bash
grep -rn "ApiKeyWarning" /mnt/c/Projects/Hadron_v3/hadron-electron/src/
```

- [ ] **Step 9.2: Remove `ApiKeyWarning` from each consumer**

For each file found in Step 9.1, remove the import line and the `<ApiKeyWarning ... />` JSX element. The status bar in `AppHeader` now handles this responsibility.

- [ ] **Step 9.3: Delete the component file**

```bash
rm /mnt/c/Projects/Hadron_v3/hadron-electron/src/components/ApiKeyWarning.tsx
```

- [ ] **Step 9.4: Commit**

```bash
git add -A
git commit -m "chore: delete ApiKeyWarning — superseded by readiness status bar"
```

---

## Task 10: Final checks

- [ ] **Step 10.1: Run full test suite**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm test
```

Expected: all existing tests pass plus the two new test files (`model-fit.test.ts`, `readiness-status.test.ts`).

- [ ] **Step 10.2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If there are errors from the old `AppHeader` props (`providerName`, `jiraConnected`, `sentryConnected`) still referenced somewhere, remove them now.

- [ ] **Step 10.3: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 10.4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix: resolve TypeScript and build issues after Trust & Readiness wiring"
```
