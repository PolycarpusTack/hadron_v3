/**
 * JIRA Rate Limiter & Circuit Breaker
 * Prevents API rate limit violations and provides resilient error handling
 *
 * Addresses:
 * - TDR-002: No rate limiting on JIRA API
 * - Implements exponential backoff for 429 responses
 * - Implements circuit breaker pattern for cascading failure prevention
 */

import logger from "./logger";
import { JIRA_CONFIG } from "./jira-storage";

// ============================================================================
// Rate Limiter (Token Bucket Algorithm)
// ============================================================================

interface RateLimiterState {
  tokens: number;
  lastRefillTime: number;
}

class TokenBucketRateLimiter {
  private state: RateLimiterState;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.state = {
      tokens: maxTokens,
      lastRefillTime: Date.now(),
    };
  }

  /**
   * Attempt to consume a token. Returns true if successful, false if rate limited.
   */
  tryConsume(): boolean {
    this.refill();
    if (this.state.tokens >= 1) {
      this.state.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Get the wait time in ms until a token is available
   */
  getWaitTime(): number {
    this.refill();
    if (this.state.tokens >= 1) {
      return 0;
    }
    const tokensNeeded = 1 - this.state.tokens;
    return Math.ceil((tokensNeeded / this.refillRate) * 1000);
  }

  /**
   * Wait until a token is available, then consume it
   */
  async waitAndConsume(): Promise<void> {
    const waitTime = this.getWaitTime();
    if (waitTime > 0) {
      logger.debug("Rate limiter waiting", { waitTimeMs: waitTime });
      await sleep(waitTime);
    }
    this.refill();
    this.state.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.state.lastRefillTime) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.state.tokens = Math.min(this.maxTokens, this.state.tokens + tokensToAdd);
    this.state.lastRefillTime = now;
  }

  /**
   * Get current state for monitoring
   */
  getState(): { tokens: number; maxTokens: number } {
    this.refill();
    return {
      tokens: Math.floor(this.state.tokens),
      maxTokens: this.maxTokens,
    };
  }
}

// ============================================================================
// Circuit Breaker
// ============================================================================

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  halfOpenRequests: number;
}

class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState;
  private readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = {
      failureThreshold: config.failureThreshold ?? JIRA_CONFIG.circuitBreakerThreshold,
      resetTimeoutMs: config.resetTimeoutMs ?? JIRA_CONFIG.circuitBreakerResetMs,
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
    };
    this.state = {
      state: "closed",
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      halfOpenRequests: 0,
    };
  }

  /**
   * Check if request is allowed
   */
  canExecute(): boolean {
    switch (this.state.state) {
      case "closed":
        return true;

      case "open":
        // Check if reset timeout has passed
        if (this.state.lastFailureTime &&
            Date.now() - this.state.lastFailureTime >= this.config.resetTimeoutMs) {
          this.transitionTo("half-open");
          return true;
        }
        return false;

      case "half-open":
        // Allow limited requests in half-open state
        return this.state.halfOpenRequests < this.config.halfOpenMaxRequests;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    switch (this.state.state) {
      case "half-open":
        this.state.successCount++;
        // If enough successes in half-open, close the circuit
        if (this.state.successCount >= this.config.halfOpenMaxRequests) {
          this.transitionTo("closed");
        }
        break;

      case "closed":
        // Reset failure count on success
        this.state.failureCount = 0;
        break;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.state.failureCount++;
    this.state.lastFailureTime = Date.now();

    switch (this.state.state) {
      case "closed":
        if (this.state.failureCount >= this.config.failureThreshold) {
          this.transitionTo("open");
        }
        break;

      case "half-open":
        // Any failure in half-open reopens the circuit
        this.transitionTo("open");
        break;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Check for automatic transition from open to half-open
    if (this.state.state === "open" &&
        this.state.lastFailureTime &&
        Date.now() - this.state.lastFailureTime >= this.config.resetTimeoutMs) {
      return "half-open";
    }
    return this.state.state;
  }

  /**
   * Get detailed status for monitoring
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number | null;
    timeUntilRetry: number | null;
  } {
    const currentState = this.getState();
    let timeUntilRetry: number | null = null;

    if (this.state.state === "open" && this.state.lastFailureTime) {
      const elapsed = Date.now() - this.state.lastFailureTime;
      timeUntilRetry = Math.max(0, this.config.resetTimeoutMs - elapsed);
    }

    return {
      state: currentState,
      failureCount: this.state.failureCount,
      lastFailureTime: this.state.lastFailureTime,
      timeUntilRetry,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo("closed");
    logger.info("Circuit breaker manually reset", { name: this.name });
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state.state;
    this.state.state = newState;

    switch (newState) {
      case "closed":
        this.state.failureCount = 0;
        this.state.successCount = 0;
        this.state.halfOpenRequests = 0;
        break;

      case "half-open":
        this.state.halfOpenRequests = 0;
        this.state.successCount = 0;
        break;

      case "open":
        this.state.halfOpenRequests = 0;
        break;
    }

    logger.info("Circuit breaker state transition", {
      name: this.name,
      from: oldState,
      to: newState,
      failureCount: this.state.failureCount,
    });
  }
}

// ============================================================================
// Retry with Exponential Backoff
// ============================================================================

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: JIRA_CONFIG.maxRetries,
  baseDelayMs: JIRA_CONFIG.retryDelayBaseMs,
  maxDelayMs: 30000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  // Exponential: 2^attempt * baseDelay
  const exponentialDelay = Math.pow(2, attempt) * baseDelay;
  // Add jitter (random 0-25% of delay)
  const jitter = exponentialDelay * Math.random() * 0.25;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Parse Retry-After header from JIRA 429 response
 * Exported for use by Rust backend response handling
 */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;

  // Try to parse as seconds
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try to parse as HTTP date
  const date = Date.parse(headerValue);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

// ============================================================================
// JIRA API Client with Rate Limiting & Circuit Breaker
// ============================================================================

export interface JiraApiError extends Error {
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

function createJiraApiError(
  message: string,
  statusCode?: number,
  retryable: boolean = false,
  retryAfterMs?: number
): JiraApiError {
  const error = new Error(message) as JiraApiError;
  error.statusCode = statusCode;
  error.retryable = retryable;
  error.retryAfterMs = retryAfterMs;
  return error;
}

// Singleton instances
const rateLimiter = new TokenBucketRateLimiter(
  JIRA_CONFIG.rateLimitPerSecond,
  JIRA_CONFIG.rateLimitPerSecond
);

const circuitBreaker = new CircuitBreaker("jira-api");

/**
 * Execute a JIRA API call with rate limiting, circuit breaker, and retry logic
 */
export async function executeWithResilience<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

  // Check circuit breaker first
  if (!circuitBreaker.canExecute()) {
    const status = circuitBreaker.getStatus();
    throw createJiraApiError(
      `JIRA API circuit breaker is open. Retry in ${Math.ceil((status.timeUntilRetry || 0) / 1000)} seconds.`,
      503,
      true,
      status.timeUntilRetry || undefined
    );
  }

  let lastError: JiraApiError | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // Wait for rate limiter
    await rateLimiter.waitAndConsume();

    try {
      const result = await operation();
      circuitBreaker.recordSuccess();
      return result;
    } catch (e) {
      const error = normalizeError(e);
      lastError = error;

      // Record failure for circuit breaker
      circuitBreaker.recordFailure();

      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries &&
        error.retryable &&
        (error.statusCode === undefined || opts.retryableStatusCodes.includes(error.statusCode));

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay
      let delayMs = error.retryAfterMs ||
        calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);

      logger.warn("JIRA API call failed, retrying", {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        statusCode: error.statusCode,
        delayMs,
        error: error.message,
      });

      await sleep(delayMs);
    }
  }

  throw lastError || createJiraApiError("Max retries exceeded", undefined, false);
}

/**
 * Normalize various error types to JiraApiError
 */
function normalizeError(e: unknown): JiraApiError {
  if (e instanceof Error) {
    // Check if it's already a JiraApiError
    if ("retryable" in e) {
      return e as JiraApiError;
    }

    // Try to extract status code from error message
    const statusMatch = e.message.match(/status[:\s]*(\d{3})/i);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

    // Determine if retryable based on error type
    const retryable = statusCode !== undefined &&
      DEFAULT_RETRY_OPTIONS.retryableStatusCodes.includes(statusCode);

    // Check for rate limit specific message
    const retryAfterMatch = e.message.match(/retry.?after[:\s]*(\d+)/i);
    const retryAfterMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : undefined;

    return createJiraApiError(e.message, statusCode, retryable, retryAfterMs);
  }

  return createJiraApiError(String(e), undefined, false);
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Exports for Monitoring & Testing
// ============================================================================

export function getRateLimiterState(): { tokens: number; maxTokens: number } {
  return rateLimiter.getState();
}

export function getCircuitBreakerStatus(): {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  timeUntilRetry: number | null;
} {
  return circuitBreaker.getStatus();
}

export function resetCircuitBreaker(): void {
  circuitBreaker.reset();
}

/**
 * Check if JIRA API is currently available (circuit not open)
 */
export function isJiraApiAvailable(): boolean {
  return circuitBreaker.canExecute();
}

/**
 * Get combined health status for UI display
 */
export function getJiraApiHealth(): {
  available: boolean;
  circuitState: CircuitState;
  rateLimitTokens: number;
  status: "healthy" | "degraded" | "unavailable";
} {
  const circuitStatus = circuitBreaker.getStatus();
  const rateLimitState = rateLimiter.getState();
  const available = circuitBreaker.canExecute();

  let status: "healthy" | "degraded" | "unavailable";
  if (!available) {
    status = "unavailable";
  } else if (circuitStatus.state === "half-open" || rateLimitState.tokens < 3) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return {
    available,
    circuitState: circuitStatus.state,
    rateLimitTokens: rateLimitState.tokens,
    status,
  };
}
