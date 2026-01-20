/**
 * Enhanced error handling utilities
 */

import logger from '../services/logger';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
}

/**
 * Retry a failed operation with exponential backoff
 *
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Result of the function
 */
export async function retryOperation<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay with optional exponential backoff
      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;

      logger.debug('Retry attempt failed, waiting before next attempt', {
        attempt,
        maxAttempts,
        delayMs: delay,
        error: lastError.message,
      });

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Get a user-friendly error message that includes the actual error details
 *
 * @param error - Error object
 * @returns User-friendly error message with actual error details
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const originalMessage = error.message;

    // Extract JSON error message if present (from API responses)
    let apiErrorMessage = originalMessage;
    const jsonMatch = originalMessage.match(/"message"\s*:\s*"([^"]+)"/);
    if (jsonMatch) {
      apiErrorMessage = jsonMatch[1];
    }

    // Network errors - show actual error
    if (originalMessage.includes("fetch") || originalMessage.includes("network")) {
      return `Network error: ${apiErrorMessage}`;
    }

    // API key errors
    if (originalMessage.includes("API key") || originalMessage.includes("401") || originalMessage.includes("Unauthorized")) {
      return `Authentication error: ${apiErrorMessage}`;
    }

    // Rate limit errors
    if (originalMessage.includes("429") || originalMessage.includes("rate limit")) {
      return `Rate limit exceeded: ${apiErrorMessage}`;
    }

    // Timeout errors
    if (originalMessage.includes("timeout") || originalMessage.includes("Timeout")) {
      return `Request timed out: ${apiErrorMessage}`;
    }

    // Model errors (like using wrong model type)
    if (originalMessage.includes("model") || originalMessage.includes("chat model")) {
      return `Model error: ${apiErrorMessage}`;
    }

    // API errors - extract and show the actual message
    if (originalMessage.includes("API error") || originalMessage.includes("error")) {
      return apiErrorMessage;
    }

    // Database errors
    if (originalMessage.includes("database") || originalMessage.includes("SQLite")) {
      return `Database error: ${apiErrorMessage}`;
    }

    // File errors
    if (originalMessage.includes("file") || originalMessage.includes("ENOENT")) {
      return `File error: ${apiErrorMessage}`;
    }

    // Python errors
    if (originalMessage.includes("Python")) {
      return `Analysis engine error: ${apiErrorMessage}`;
    }

    // Default to original error message
    return originalMessage;
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error;
  }

  return "An unexpected error occurred. Please try again.";
}

/**
 * Check if user is online
 *
 * @returns true if online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Get recovery suggestions based on error
 *
 * @param error - Error object
 * @returns Array of suggested recovery steps
 */
export function getRecoverySuggestions(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const suggestions: string[] = [];

  if (message.includes("network") || message.includes("fetch")) {
    suggestions.push("Check your internet connection");
    suggestions.push("Verify firewall settings");
    suggestions.push("Try again in a few moments");
  }

  if (message.includes("API key") || message.includes("401") || message.includes("Unauthorized")) {
    suggestions.push("Open Settings and verify your API key");
    suggestions.push("Ensure the API key starts with 'sk-'");
    suggestions.push("Generate a new API key if needed");
  }

  if (message.includes("429") || message.includes("rate limit")) {
    suggestions.push("Wait a few minutes before trying again");
    suggestions.push("Consider upgrading your OpenAI plan");
  }

  // Model-related errors
  if (message.includes("not a chat model") || message.includes("chat/completions")) {
    suggestions.push("Select a chat-compatible model (e.g., gpt-4o, gpt-4-turbo, gpt-3.5-turbo)");
    suggestions.push("Avoid codex or completion-only models");
    suggestions.push("Open Settings to change the model");
  } else if (message.includes("model")) {
    suggestions.push("Check that the selected model is available");
    suggestions.push("Try a different model in Settings");
  }

  if (message.includes("timeout") || message.includes("Timeout")) {
    suggestions.push("The request took too long - try again");
    suggestions.push("Large files may need more time to process");
    suggestions.push("Check your internet connection speed");
  }

  if (message.includes("database")) {
    suggestions.push("Close and restart the application");
    suggestions.push("Check available disk space");
  }

  if (message.includes("Python")) {
    suggestions.push("Ensure Python 3.10+ is installed");
    suggestions.push("Run 'pip install -r requirements.txt'");
    suggestions.push("Check the console for detailed error messages");
  }

  // Default suggestions
  if (suggestions.length === 0) {
    suggestions.push("Try again");
    suggestions.push("Check Settings for configuration issues");
    suggestions.push("Restart the application if the problem persists");
  }

  return suggestions;
}
