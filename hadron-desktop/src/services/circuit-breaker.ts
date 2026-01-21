/**
 * Circuit Breaker Service
 * Provides automatic failover when AI providers fail
 *
 * Browser-compatible implementation (no Node.js dependencies)
 * Alex Chen's Rule: "Make it boring, make it reliable"
 */

import { invoke } from '@tauri-apps/api/core';
import logger from './logger';
import type { AnalysisResponse } from './api';
import { getApiKey } from './secure-storage';
import { getBooleanSetting } from '../utils/config';
import { apiCache, CacheKeys } from './cache';
import { getKeeperSecretForProvider } from './keeper';

/**
 * SECURITY: Sanitize error messages before exposing to UI
 * Removes potentially sensitive information like paths, keys, stack traces
 */
function sanitizeErrorMessage(message: string): string {
  if (!message) return 'Unknown error';

  // Truncate long messages
  let sanitized = message.length > 200 ? message.slice(0, 200) + '...' : message;

  // Remove file paths (Unix and Windows)
  sanitized = sanitized.replace(/\/[\w\-./]+/g, '[path]');
  sanitized = sanitized.replace(/[A-Z]:\\[\w\-\\./]+/gi, '[path]');

  // Remove anything that looks like an API key
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{10,}/g, '[key]');
  sanitized = sanitized.replace(/api[_-]?key[=:]\s*\S+/gi, '[key]');

  return sanitized;
}

// Extended AnalysisRequest with Keeper support and token-safe analysis
interface AnalysisRequest {
  file_path: string;
  api_key: string;
  model: string;
  provider: string;
  analysis_type: string;
  redact_pii?: boolean;
  keeper_secret_uid?: string;
  // Token-safe analysis mode: "quick" | "deep_scan" | "auto"
  analysis_mode?: string;
}

// Circuit breaker configuration
const CIRCUIT_OPTIONS = {
  timeout: 300000,              // 5 minute timeout - deep scan with 50+ chunks can take 3-4 minutes
  errorThresholdPercentage: 50, // Open circuit at 50% error rate
  resetTimeout: 60000,          // Try again after 1 minute
  volumeThreshold: 3,           // Need minimum 3 requests to calculate error rate
};

/**
 * Simple browser-compatible circuit breaker state
 */
interface CircuitState {
  provider: string;
  isOpen: boolean;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
}

/**
 * Individual circuit breakers for each provider
 */
const breakers: Record<string, CircuitState> = {};

/**
 * Get or create circuit breaker for a provider
 */
function getBreaker(provider: string): CircuitState {
  if (!breakers[provider]) {
    breakers[provider] = {
      provider,
      isOpen: false,
      failures: 0,
      successes: 0,
      totalCalls: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
    };
  }

  return breakers[provider];
}

/**
 * Check if circuit should reset (after timeout)
 */
function shouldReset(breaker: CircuitState): boolean {
  if (!breaker.isOpen || !breaker.lastFailureTime) {
    return false;
  }

  const timeSinceFailure = Date.now() - breaker.lastFailureTime;
  return timeSinceFailure > CIRCUIT_OPTIONS.resetTimeout;
}

/**
 * Record success for a provider
 * NOTE: Updates are atomic in JavaScript's single-threaded event loop,
 * but we use Object.assign for clarity and to batch all updates together.
 */
function recordSuccess(provider: string): void {
  const breaker = getBreaker(provider);
  const wasOpen = breaker.isOpen;

  // Batch all updates together for atomic modification
  Object.assign(breaker, {
    successes: breaker.successes + 1,
    totalCalls: breaker.totalCalls + 1,
    lastSuccessTime: Date.now(),
    isOpen: false,  // Always close on success
  });

  if (wasOpen) {
    logger.info('Circuit breaker CLOSED - recovered', { provider });
  }
}

/**
 * Record failure for a provider
 * NOTE: Updates are atomic in JavaScript's single-threaded event loop,
 * but we use Object.assign for clarity and to batch all updates together.
 */
function recordFailure(provider: string): void {
  const breaker = getBreaker(provider);

  // Calculate new values before mutation
  const newFailures = breaker.failures + 1;
  const newTotalCalls = breaker.totalCalls + 1;
  const errorRate = (newFailures / newTotalCalls) * 100;
  const shouldOpen = newTotalCalls >= CIRCUIT_OPTIONS.volumeThreshold &&
                     errorRate >= CIRCUIT_OPTIONS.errorThresholdPercentage &&
                     !breaker.isOpen;

  // Batch all updates together for atomic modification
  Object.assign(breaker, {
    failures: newFailures,
    totalCalls: newTotalCalls,
    lastFailureTime: Date.now(),
    isOpen: shouldOpen ? true : breaker.isOpen,
  });

  if (shouldOpen) {
    logger.warn('Circuit breaker OPENED - too many failures', {
      provider,
      errorRate: errorRate.toFixed(1),
      failures: newFailures,
      total: newTotalCalls
    });
  }
}

/**
 * Call AI provider through Rust backend with timeout
 */
async function callAIProvider(request: AnalysisRequest): Promise<AnalysisResponse> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), CIRCUIT_OPTIONS.timeout);
  });

  const callPromise = invoke<AnalysisResponse>('analyze_crash_log', { request });

  return Promise.race([callPromise, timeoutPromise]);
}

/**
 * Get active providers from localStorage
 */
function getActiveProviders(): string[] {
  const savedActiveProviders = localStorage.getItem("active_providers");
  if (savedActiveProviders) {
    try {
      const activeProviders = JSON.parse(savedActiveProviders);
      // Type-safe validation
      if (typeof activeProviders === 'object' && activeProviders !== null) {
        return Object.keys(activeProviders).filter(p => activeProviders[p] === true);
      }
    } catch (e) {
      logger.warn('Failed to parse active providers, using defaults', { error: e });
    }
  }
  // Default to primary providers (vLLM and llama.cpp are opt-in)
  return ['openai', 'anthropic', 'ollama', 'zai'];
}

/**
 * Get alternative providers for fallback (only active ones)
 */
function getAlternatives(preferredProvider: string): string[] {
  const activeProviders = getActiveProviders();
  return activeProviders.filter(p => p !== preferredProvider);
}

function defaultModelForProvider(provider: string, currentModel: string): string {
  const p = provider.toLowerCase();
  // If current model already matches provider family, keep it
  if ((p === 'openai' && currentModel.startsWith('gpt-')) ||
      (p === 'anthropic' && currentModel.startsWith('claude')) ||
      (p === 'zai' && (currentModel.startsWith('glm-') || currentModel.startsWith('qwen')))) {
    return currentModel;
  }
  // Otherwise choose sensible defaults
  if (p === 'anthropic') return 'claude-3-5-sonnet-20241022';
  if (p === 'zai') return 'glm-4.6';
  if (p === 'ollama') return 'llama3.2:3b'; // Default local model (lightweight)
  return 'gpt-4-turbo-preview';
}

/**
 * Analyze crash log with automatic failover
 *
 * This is the main function that wraps analyzeCrashLog with resilience:
 * - Tries preferred provider first
 * - Falls back to alternatives if it fails
 * - Respects circuit breaker state (skips if open)
 *
 * @param filePath - Path to crash log file
 * @param apiKey - API key for the provider
 * @param model - AI model to use
 * @param preferredProvider - User's preferred provider
 * @param analysisType - Type of analysis ("complete" or "specialized")
 * @param analysisMode - Token-safe analysis mode ("quick", "deep_scan", or "auto")
 * @returns Analysis result from the first successful provider
 * @throws Error if all providers fail
 */
export async function analyzeWithResilience(
  filePath: string,
  apiKey: string,
  model: string,
  preferredProvider: string,
  analysisType: string = "complete",
  analysisMode: string = "auto"
): Promise<AnalysisResponse> {

  // Build fallback chain: preferred → alternatives
  const fallbackChain = [preferredProvider, ...getAlternatives(preferredProvider)];

  const errors: Array<{ provider: string; error: string }> = [];

  let attemptNumber = 0;
  const totalProviders = fallbackChain.length;

  for (const provider of fallbackChain) {
    attemptNumber++;
    const breaker = getBreaker(provider);

    // Check if circuit should reset
    if (shouldReset(breaker)) {
      breaker.isOpen = false;
      breaker.failures = 0;
      breaker.successes = 0;
      breaker.totalCalls = 0;
      logger.info('Circuit breaker reset after timeout', { provider });
    }

    // Skip if circuit is open (provider is known to be failing)
    if (breaker.isOpen) {
      logger.warn(`Attempt ${attemptNumber}/${totalProviders}: Skipping ${provider} - circuit breaker is open`, { provider });
      errors.push({
        provider,
        error: 'Circuit breaker open - provider unavailable'
      });
      continue;
    }

    try {
      const isFailover = provider !== preferredProvider;
      const attemptMessage = isFailover
        ? `Attempt ${attemptNumber}/${totalProviders}: Failover to ${provider}`
        : `Attempt ${attemptNumber}/${totalProviders}: Trying ${provider}`;

      logger.info(attemptMessage, { provider, model, analysisType, attemptNumber, totalProviders });

      // Check if Keeper is configured for this provider
      const keeperSecretUid = await getKeeperSecretForProvider(provider);

      // Ollama runs locally and doesn't need an API key
      // If Keeper is configured, we don't need a direct API key
      const providerKey = provider === "ollama"
        ? ""
        : keeperSecretUid
          ? ""  // Keeper will provide the key in the backend
          : ((await getApiKey(provider)) || apiKey);

      // Only check for API key if not using Ollama and not using Keeper
      if (provider !== "ollama" && !providerKey && !keeperSecretUid) {
        throw new Error('Missing API key for provider');
      }

      // Adjust model if switching provider families
      const providerModel = defaultModelForProvider(provider, model);

      const redactPii = getBooleanSetting("pii_redaction_enabled");

      const request: AnalysisRequest = {
        file_path: filePath,
        api_key: providerKey,
        model: providerModel,
        provider: provider,
        analysis_type: analysisType,
        redact_pii: redactPii,
        keeper_secret_uid: keeperSecretUid || undefined,
        analysis_mode: analysisMode,
      };

      if (keeperSecretUid) {
        logger.info('Using Keeper for API key', { provider });
      }

      const result = await callAIProvider(request);

      // Record success
      recordSuccess(provider);

      // Invalidate analysis caches since new analysis was added
      apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
      apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);

      logger.info('Analysis successful', { provider, model, wasFailover: provider !== preferredProvider });

      // Track which provider was used (for UI display)
      (result as any)._usedProvider = provider;
      (result as any)._wasFailover = provider !== preferredProvider;

      return result;

    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';

      // Record failure
      recordFailure(provider);

      logger.warn(`Attempt ${attemptNumber}/${totalProviders} failed: ${provider}`, {
        provider,
        error: errorMessage,
        attemptNumber,
        totalProviders
      });

      errors.push({
        provider,
        error: errorMessage
      });

      // Continue to next provider in chain
    }
  }

  // All providers failed - SECURITY: sanitize error messages before exposing
  const errorSummary = errors.map(e => `${e.provider}: ${sanitizeErrorMessage(e.error)}`).join('; ');
  throw new Error(`All AI providers failed. ${errorSummary}`);
}

/**
 * Get circuit breaker state for UI display
 *
 * @param provider - Provider name
 * @returns 'healthy' | 'degraded' | 'down'
 */
export function getCircuitState(provider: string): 'healthy' | 'degraded' | 'down' {
  const breaker = breakers[provider];

  if (!breaker) {
    return 'healthy'; // Not used yet
  }

  if (breaker.isOpen) {
    return 'down'; // Circuit open - provider unavailable
  }

  // Check recent error rate
  const errorRate = breaker.totalCalls > 0 ? breaker.failures / breaker.totalCalls : 0;

  if (errorRate > 0.3) {
    return 'degraded'; // >30% error rate
  }

  return 'healthy';
}

/**
 * Get circuit breaker statistics for debugging
 */
export function getCircuitStats(provider: string) {
  const breaker = breakers[provider];

  if (!breaker) {
    return null;
  }

  const errorRate = breaker.totalCalls > 0 ? breaker.failures / breaker.totalCalls : 0;

  return {
    provider,
    state: breaker.isOpen ? 'open' : 'closed',
    fires: breaker.totalCalls,
    successes: breaker.successes,
    failures: breaker.failures,
    errorRate,
  };
}

/**
 * Reset circuit breaker for a provider (for testing/recovery)
 */
export function resetCircuit(provider: string): void {
  const breaker = breakers[provider];
  if (breaker) {
    breaker.isOpen = false;
    breaker.failures = 0;
    breaker.successes = 0;
    breaker.totalCalls = 0;
    logger.info('Reset circuit breaker', { provider });
  }
}

/**
 * Get all circuit breaker stats (for diagnostics export)
 */
export function getAllCircuitStats() {
  return Object.keys(breakers).map(provider => getCircuitStats(provider));
}
