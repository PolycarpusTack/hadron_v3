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
 * Get a user-friendly error message
 *
 * @param error - Error object
 * @returns User-friendly error message
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes("fetch") || error.message.includes("network")) {
      return "Network error. Please check your internet connection and try again.";
    }

    // API key errors
    if (error.message.includes("API key") || error.message.includes("401")) {
      return "Invalid API key. Please check your OpenAI API key in Settings.";
    }

    // Rate limit errors
    if (error.message.includes("429") || error.message.includes("rate limit")) {
      return "Rate limit exceeded. Please wait a moment and try again.";
    }

    // Timeout errors
    if (error.message.includes("timeout")) {
      return "Request timed out. Please try again.";
    }

    // Database errors
    if (error.message.includes("database") || error.message.includes("SQLite")) {
      return "Database error. Your analysis may not have been saved. Please try again.";
    }

    // File errors
    if (error.message.includes("file") || error.message.includes("ENOENT")) {
      return "File not found or cannot be read. Please check the file path.";
    }

    // Python errors
    if (error.message.includes("Python")) {
      return "Analysis engine error. Please ensure Python is installed and configured correctly.";
    }

    // Default to error message
    return error.message;
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

  if (message.includes("API key") || message.includes("401")) {
    suggestions.push("Open Settings and verify your API key");
    suggestions.push("Ensure the API key starts with 'sk-'");
    suggestions.push("Generate a new API key if needed");
  }

  if (message.includes("429") || message.includes("rate limit")) {
    suggestions.push("Wait a few minutes before trying again");
    suggestions.push("Consider upgrading your OpenAI plan");
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
    suggestions.push("Restart the application if the problem persists");
    suggestions.push("Check the console for more details");
  }

  return suggestions;
}
