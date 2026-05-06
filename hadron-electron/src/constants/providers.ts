/**
 * Centralized AI provider configuration.
 * All provider-related defaults should be defined here to avoid
 * hardcoded strings scattered across the codebase.
 */

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-4-0",
  zai: "glm-4",
  llamacpp: "default",
  vllm: "default",
};

export const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultActive: true },
  { value: "anthropic", label: "Anthropic", defaultActive: false },
  { value: "zai", label: "Z.ai (GLM/Qwen)", defaultActive: false },
  { value: "llamacpp", label: "llama.cpp (Local)", defaultActive: false },
  { value: "vllm", label: "vLLM", defaultActive: false },
] as const;

export type ProviderKey = (typeof AI_PROVIDERS)[number]["value"];

/**
 * Curated model lists per provider — models suited for Hadron's use case
 * (crash analysis, code review, release notes generation: strong reasoning + large context).
 * These serve as reliable fallbacks when the API cache is empty or stale.
 */
export interface CuratedModel {
  id: string;
  label: string;
  context: number;
  category: string;
  maxOutputTokens?: number;
  preferredEndpoint?: "responses" | "chat_completions";
  suitableForHadron?: boolean;
}

export const CURATED_MODELS: Record<string, CuratedModel[]> = {
  openai: [
    { id: "gpt-5.5", label: "GPT-5.5 (Best)", context: 1000000, maxOutputTokens: 128000, preferredEndpoint: "responses", suitableForHadron: true, category: "recommended" },
    { id: "gpt-5.4", label: "GPT-5.4 (Recommended)", context: 1000000, maxOutputTokens: 128000, preferredEndpoint: "responses", suitableForHadron: true, category: "recommended" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini (Default)", context: 400000, maxOutputTokens: 128000, preferredEndpoint: "responses", suitableForHadron: true, category: "fast" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano (Cheapest)", context: 400000, maxOutputTokens: 128000, preferredEndpoint: "responses", suitableForHadron: true, category: "cheap" },
    { id: "gpt-4.1", label: "GPT-4.1 (Large Context)", context: 1047576, maxOutputTokens: 32768, preferredEndpoint: "responses", suitableForHadron: true, category: "large-context" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini (Large Context)", context: 1047576, maxOutputTokens: 32768, preferredEndpoint: "responses", suitableForHadron: true, category: "fast" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (Large Context)", context: 1047576, maxOutputTokens: 32768, preferredEndpoint: "responses", suitableForHadron: true, category: "cheap" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-0", label: "Claude Sonnet 4 (Recommended)", context: 200000, category: "recommended" },
    { id: "claude-opus-4-1-20250805", label: "Claude Opus 4.1", context: 200000, category: "reasoning" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4", context: 200000, category: "reasoning" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", context: 200000, category: "standard" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Fast/Cheap)", context: 200000, category: "fast" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus", context: 200000, category: "standard" },
    { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku (Fast/Cheap)", context: 200000, category: "fast" },
  ],
  zai: [
    { id: "glm-4.6", label: "GLM-4.6 (Latest)", context: 200000, category: "latest" },
    { id: "glm-4", label: "GLM-4", context: 128000, category: "standard" },
    { id: "glm-4-flash", label: "GLM-4 Flash (Fast/Cheap)", context: 128000, category: "fast" },
  ],
  llamacpp: [
    { id: "default", label: "Default Model", context: 0, category: "local" },
  ],
  vllm: [
    { id: "default", label: "Default Model", context: 0, category: "local" },
  ],
};

/** Model cache TTL — 7 days in milliseconds */
export const MODEL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Get the default model for a given provider.
 */
export function getDefaultModelForProvider(provider: string): string {
  return PROVIDER_DEFAULT_MODELS[provider] || "gpt-5.4-mini";
}

/**
 * Get curated models for a provider (used as fallback when cache is empty).
 */
export function getCuratedModelsForProvider(provider: string): CuratedModel[] {
  return CURATED_MODELS[provider] || [];
}
