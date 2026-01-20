/**
 * Production Logging Service
 * Browser-compatible structured logging for Tauri frontend
 * Logs are sent to Rust backend via Tauri's log plugin
 * Includes in-memory buffer for console viewer (Ctrl+Y)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, any>;
}

// In-memory log buffer for console viewer
const MAX_LOG_ENTRIES = 500;
let logBuffer: LogEntry[] = [];
let logIdCounter = 0;
let logChangeListeners: (() => void)[] = [];

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

// Add log entry to buffer
function addToBuffer(level: LogLevel, message: string, meta?: any) {
  const entry: LogEntry = {
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    level,
    message,
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
  debug: (message: string, meta?: any) => {
    addToBuffer('debug', message, meta);
    const formatted = formatLog('debug', message, meta);
    console.debug(formatted);
  },

  info: (message: string, meta?: any) => {
    addToBuffer('info', message, meta);
    const formatted = formatLog('info', message, meta);
    console.info(formatted);
  },

  warn: (message: string, meta?: any) => {
    addToBuffer('warn', message, meta);
    const formatted = formatLog('warn', message, meta);
    console.warn(formatted);
  },

  error: (message: string, meta?: any) => {
    addToBuffer('error', message, meta);
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
};

export default logger;
