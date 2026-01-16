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

// Helper function to sanitize sensitive data
function sanitize(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized = { ...data };
  const sensitiveKeys = ['apiKey', 'api_key', 'password', 'token', 'secret'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '***REDACTED***';
    }
  }

  return sanitized;
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
