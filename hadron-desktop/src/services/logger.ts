/**
 * Production Logging Service
 * Browser-compatible structured logging for Tauri frontend
 * Logs are sent to Rust backend via Tauri's log plugin
 * Includes in-memory buffer for console viewer (Ctrl+Y)
 *
 * Features:
 * - Source/component tracking
 * - Performance timing helpers
 * - Log categories/tags
 * - Correlation IDs for request tracking
 * - Stack traces for errors
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory =
  | 'api'        // API calls and responses
  | 'ui'         // UI interactions and rendering
  | 'parser'     // Crash/trace parsing
  | 'db'         // Database operations
  | 'export'     // Export operations
  | 'perf'       // Performance metrics
  | 'system'     // System events
  | 'user'       // User actions
  | 'error';     // Errors and exceptions

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;           // Component/service that logged
  category?: LogCategory;    // Log category for filtering
  correlationId?: string;    // Request correlation ID
  duration?: number;         // Duration in ms for timed operations
  stack?: string;            // Stack trace for errors
  meta?: Record<string, unknown>;
}

// In-memory log buffer for console viewer
const MAX_LOG_ENTRIES = 1000;
let logBuffer: LogEntry[] = [];
let logIdCounter = 0;
let logChangeListeners: (() => void)[] = [];
let isPaused = false;

// Active timers for performance tracking
const activeTimers = new Map<string, { start: number; source?: string; category?: LogCategory }>();

// Generate unique correlation IDs
let correlationCounter = 0;
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${(++correlationCounter).toString(36)}`;
}

// Sensitive key patterns to redact
const SENSITIVE_KEY_PATTERNS = ['apikey', 'api_key', 'password', 'token', 'secret', 'authorization', 'credential', 'bearer'];

// Sensitive value patterns (e.g., OpenAI API keys)
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[A-Za-z0-9]{10,}/, // OpenAI/Anthropic API keys
  /^Bearer\s+.+/i,        // Bearer tokens
];

/**
 * Deep recursive sanitization of sensitive data in log metadata
 * Handles nested objects and arrays to prevent API key leakage
 */
function sanitize(data: any, depth: number = 0): any {
  // Prevent infinite recursion on deeply nested or circular structures
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle strings - check for sensitive value patterns
  if (typeof data === 'string') {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(data)) {
        return '***REDACTED***';
      }
    }
    return data;
  }

  // Handle arrays - recursively sanitize each element
  if (Array.isArray(data)) {
    return data.map(item => sanitize(item, depth + 1));
  }

  // Handle objects - recursively sanitize
  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};

    for (const key of Object.keys(data)) {
      const lowerKey = key.toLowerCase();

      // Check if key matches sensitive patterns
      if (SENSITIVE_KEY_PATTERNS.some(pattern => lowerKey.includes(pattern))) {
        sanitized[key] = '***REDACTED***';
      } else {
        // Recursively sanitize nested values
        sanitized[key] = sanitize(data[key], depth + 1);
      }
    }

    return sanitized;
  }

  // Return primitives (numbers, booleans) as-is
  return data;
}

// Extended log options
export interface LogOptions {
  source?: string;
  category?: LogCategory;
  correlationId?: string;
  duration?: number;
  includeStack?: boolean;
}

// Add log entry to buffer
function addToBuffer(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
  options?: LogOptions
) {
  if (isPaused) return;

  const entry: LogEntry = {
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    level,
    message,
    source: options?.source,
    category: options?.category,
    correlationId: options?.correlationId,
    duration: options?.duration,
    stack: options?.includeStack || level === 'error' ? getStackTrace() : undefined,
    meta: meta ? sanitize(meta) : undefined,
  };

  logBuffer.push(entry);

  // Trim buffer if too large
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }

  // Notify listeners
  logChangeListeners.forEach(fn => fn());
}

// Get stack trace (skip internal frames)
function getStackTrace(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;
    // Skip the first 4 lines (Error, getStackTrace, addToBuffer, logger method)
    const lines = stack.split('\n').slice(4);
    return lines.join('\n').trim() || undefined;
  } catch {
    return undefined;
  }
}

// Format log entry with timestamp and metadata (for console output)
function formatLog(level: string, message: string, meta?: any): string {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: 'hadron-frontend',
    message,
    ...sanitize(meta || {}),
  };
  return JSON.stringify(logEntry);
}

// Browser-compatible logger using console with structured formatting
const logger = {
  debug: (message: string, meta?: Record<string, unknown>, options?: LogOptions) => {
    addToBuffer('debug', message, meta, options);
    const formatted = formatLog('debug', message, meta);
    console.debug(formatted);
  },

  info: (message: string, meta?: Record<string, unknown>, options?: LogOptions) => {
    addToBuffer('info', message, meta, options);
    const formatted = formatLog('info', message, meta);
    console.info(formatted);
  },

  warn: (message: string, meta?: Record<string, unknown>, options?: LogOptions) => {
    addToBuffer('warn', message, meta, options);
    const formatted = formatLog('warn', message, meta);
    console.warn(formatted);
  },

  error: (message: string, meta?: Record<string, unknown>, options?: LogOptions) => {
    addToBuffer('error', message, meta, { ...options, includeStack: true });
    const formatted = formatLog('error', message, meta);
    console.error(formatted);
  },

  // Get all logs from buffer
  getLogs: (): LogEntry[] => [...logBuffer],

  // Clear log buffer
  clearLogs: () => {
    logBuffer = [];
    logChangeListeners.forEach(fn => fn());
  },

  // Subscribe to log changes
  subscribe: (callback: () => void): (() => void) => {
    logChangeListeners.push(callback);
    return () => {
      logChangeListeners = logChangeListeners.filter(fn => fn !== callback);
    };
  },

  // Pause/resume logging (for console viewer)
  pause: () => { isPaused = true; },
  resume: () => { isPaused = false; },
  isPaused: () => isPaused,

  // Performance timing helpers
  time: (label: string, options?: { source?: string; category?: LogCategory }) => {
    activeTimers.set(label, {
      start: performance.now(),
      source: options?.source,
      category: options?.category ?? 'perf',
    });
  },

  timeEnd: (label: string, meta?: Record<string, unknown>) => {
    const timer = activeTimers.get(label);
    if (!timer) {
      logger.warn(`Timer "${label}" does not exist`, undefined, { category: 'perf' });
      return;
    }
    const duration = Math.round(performance.now() - timer.start);
    activeTimers.delete(label);

    logger.info(`${label} completed`, { ...meta, duration_ms: duration }, {
      source: timer.source,
      category: timer.category,
      duration,
    });
  },

  // Async operation wrapper with automatic timing
  async timed<T>(
    label: string,
    operation: () => Promise<T>,
    options?: { source?: string; category?: LogCategory; meta?: Record<string, unknown> }
  ): Promise<T> {
    const start = performance.now();
    const correlationId = generateCorrelationId();

    logger.debug(`${label} started`, options?.meta, {
      source: options?.source,
      category: options?.category ?? 'perf',
      correlationId,
    });

    try {
      const result = await operation();
      const duration = Math.round(performance.now() - start);

      logger.info(`${label} completed`, { ...options?.meta, duration_ms: duration }, {
        source: options?.source,
        category: options?.category ?? 'perf',
        correlationId,
        duration,
      });

      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);

      logger.error(`${label} failed`, {
        ...options?.meta,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }, {
        source: options?.source,
        category: 'error',
        correlationId,
        duration,
      });

      throw error;
    }
  },

  // Create a child logger with preset source/category
  child: (defaultOptions: { source: string; category?: LogCategory }) => ({
    debug: (message: string, meta?: Record<string, unknown>, options?: LogOptions) =>
      logger.debug(message, meta, { ...defaultOptions, ...options }),
    info: (message: string, meta?: Record<string, unknown>, options?: LogOptions) =>
      logger.info(message, meta, { ...defaultOptions, ...options }),
    warn: (message: string, meta?: Record<string, unknown>, options?: LogOptions) =>
      logger.warn(message, meta, { ...defaultOptions, ...options }),
    error: (message: string, meta?: Record<string, unknown>, options?: LogOptions) =>
      logger.error(message, meta, { ...defaultOptions, ...options }),
    time: (label: string) => logger.time(label, defaultOptions),
    timeEnd: (label: string, meta?: Record<string, unknown>) => logger.timeEnd(label, meta),
    timed: <T>(label: string, operation: () => Promise<T>, meta?: Record<string, unknown>) =>
      logger.timed(label, operation, { ...defaultOptions, meta }),
  }),

  // Get statistics about current logs
  getStats: () => {
    const stats = {
      total: logBuffer.length,
      byLevel: { debug: 0, info: 0, warn: 0, error: 0 } as Record<LogLevel, number>,
      byCategory: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
    };

    for (const entry of logBuffer) {
      stats.byLevel[entry.level]++;
      if (entry.category) {
        stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
      }
      if (entry.source) {
        stats.bySource[entry.source] = (stats.bySource[entry.source] || 0) + 1;
      }
    }

    return stats;
  },

  // Export logs in different formats
  export: (format: 'json' | 'text' | 'csv' = 'json'): string => {
    switch (format) {
      case 'json':
        return JSON.stringify(logBuffer, null, 2);

      case 'text':
        return logBuffer.map(entry => {
          const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
          const source = entry.source ? `[${entry.source}]` : '';
          const category = entry.category ? `(${entry.category})` : '';
          const duration = entry.duration ? ` [${entry.duration}ms]` : '';
          const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
          return `${time} ${entry.level.toUpperCase().padEnd(5)} ${source}${category} ${entry.message}${duration}${meta}`;
        }).join('\n');

      case 'csv':
        const headers = ['timestamp', 'level', 'source', 'category', 'message', 'duration', 'correlationId', 'meta'];
        const rows = logBuffer.map(entry => [
          entry.timestamp,
          entry.level,
          entry.source || '',
          entry.category || '',
          `"${entry.message.replace(/"/g, '""')}"`,
          entry.duration?.toString() || '',
          entry.correlationId || '',
          entry.meta ? `"${JSON.stringify(entry.meta).replace(/"/g, '""')}"` : '',
        ].join(','));
        return [headers.join(','), ...rows].join('\n');
    }
  },
};

export default logger;
