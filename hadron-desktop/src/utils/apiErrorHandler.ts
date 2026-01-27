/**
 * Reusable API Error Handler
 * Reduces code duplication across components by providing a consistent
 * pattern for handling async operations with success/error feedback.
 */

import logger from '../services/logger';

export interface ErrorHandlerOptions {
  /** Message to show on success (optional - no toast if omitted) */
  successMessage?: string;
  /** Message to show on error (defaults to "An error occurred") */
  errorMessage?: string;
  /** Logger source for tracking */
  source?: string;
  /** Additional context for logging */
  context?: Record<string, unknown>;
  /** Custom error handler (called instead of default toast) */
  onError?: (error: Error | unknown) => void;
  /** Custom success handler (called in addition to toast) */
  onSuccess?: () => void;
  /** Whether to rethrow the error after handling */
  rethrow?: boolean;
}

/** Toast function type - will be injected at runtime */
type ToastFn = {
  success: (message: string) => void;
  error: (message: string) => void;
};

let toastFn: ToastFn | null = null;

/**
 * Initialize the error handler with toast functions.
 * Call this once in App.tsx or main.tsx
 */
export function initializeErrorHandler(toast: ToastFn): void {
  toastFn = toast;
}

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Execute an async operation with standardized error handling.
 *
 * @example
 * // Basic usage
 * const result = await withErrorHandling(
 *   () => deleteAnalysis(id),
 *   { successMessage: "Analysis deleted", errorMessage: "Failed to delete" }
 * );
 *
 * @example
 * // With context logging
 * await withErrorHandling(
 *   () => api.bulkDelete(ids),
 *   {
 *     successMessage: `Deleted ${ids.length} items`,
 *     source: 'HistoryView',
 *     context: { count: ids.length }
 *   }
 * );
 *
 * @example
 * // Without success toast (silent success)
 * const data = await withErrorHandling(
 *   () => fetchData(),
 *   { errorMessage: "Failed to load data" }
 * );
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: ErrorHandlerOptions = {}
): Promise<T | null> {
  const {
    successMessage,
    errorMessage = 'An error occurred',
    source = 'app',
    context = {},
    onError,
    onSuccess,
    rethrow = false,
  } = options;

  try {
    const result = await operation();

    // Show success toast if message provided
    if (successMessage && toastFn) {
      toastFn.success(successMessage);
    }

    // Call custom success handler
    if (onSuccess) {
      onSuccess();
    }

    // Log success at debug level
    logger.debug(`Operation successful: ${successMessage || 'unnamed'}`, {
      source,
      ...context,
    });

    return result;
  } catch (error) {
    const message = getErrorMessage(error);

    // Log error
    logger.error(errorMessage, {
      source,
      error: message,
      ...context,
    });

    // Custom error handler or default toast
    if (onError) {
      onError(error);
    } else if (toastFn) {
      toastFn.error(errorMessage);
    }

    // Optionally rethrow
    if (rethrow) {
      throw error;
    }

    return null;
  }
}

/**
 * Execute multiple async operations with combined error handling.
 * All operations run in parallel. Partial failures are logged but don't
 * stop other operations.
 *
 * @example
 * const results = await withBulkErrorHandling(
 *   ids.map(id => () => deleteAnalysis(id)),
 *   {
 *     successMessage: (succeeded) => `Deleted ${succeeded} items`,
 *     errorMessage: (failed) => `Failed to delete ${failed} items`
 *   }
 * );
 */
export async function withBulkErrorHandling<T>(
  operations: Array<() => Promise<T>>,
  options: {
    successMessage?: (succeeded: number) => string;
    errorMessage?: (failed: number) => string;
    source?: string;
  } = {}
): Promise<{ results: T[]; errors: Error[] }> {
  const { source = 'app', successMessage, errorMessage } = options;

  const results: T[] = [];
  const errors: Error[] = [];

  const settled = await Promise.allSettled(operations.map(op => op()));

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
    }
  }

  // Log and show appropriate messages
  if (errors.length === 0 && successMessage && toastFn) {
    toastFn.success(successMessage(results.length));
    logger.info(`Bulk operation completed`, { source, succeeded: results.length });
  } else if (errors.length > 0 && errorMessage && toastFn) {
    toastFn.error(errorMessage(errors.length));
    logger.error(`Bulk operation had failures`, {
      source,
      succeeded: results.length,
      failed: errors.length,
      errors: errors.map(e => e.message).slice(0, 5), // Log first 5 errors
    });
  }

  return { results, errors };
}

/**
 * Wrap an event handler with error handling.
 * Useful for onClick handlers that call async functions.
 *
 * @example
 * <button onClick={handleAsync(() => deleteItem(id), { errorMessage: "Delete failed" })}>
 *   Delete
 * </button>
 */
export function handleAsync<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
  options: ErrorHandlerOptions = {}
): (...args: T) => void {
  return (...args: T) => {
    withErrorHandling(() => handler(...args), options);
  };
}
