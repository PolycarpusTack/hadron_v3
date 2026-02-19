/**
 * Centralized AI provider configuration.
 * All provider-related defaults should be defined here to avoid
 * hardcoded strings scattered across the codebase.
 */

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  zai: "glm-4",
  llamacpp: "default",
  vllm: "default",
};

export const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultActive: true },
  { value: "anthropic", label: "Anthropic", defaultActive: true },
  { value: "zai", label: "Z.ai (GLM/Qwen)", defaultActive: true },
  { value: "llamacpp", label: "llama.cpp (Local)", defaultActive: true },
  { value: "vllm", label: "vLLM", defaultActive: false },
] as const;

export type ProviderKey = (typeof AI_PROVIDERS)[number]["value"];

/**
 * Get the default model for a given provider.
 */
export function getDefaultModelForProvider(provider: string): string {
  return PROVIDER_DEFAULT_MODELS[provider] || "gpt-4o";
}
