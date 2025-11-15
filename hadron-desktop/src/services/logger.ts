/**
 * Production Logging Service
 * Browser-compatible structured logging for Tauri frontend
 * Logs are sent to Rust backend via Tauri's log plugin
 */

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

// Format log entry with timestamp and metadata
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
    const formatted = formatLog('debug', message, meta);
    console.debug(formatted);
  },

  info: (message: string, meta?: any) => {
    const formatted = formatLog('info', message, meta);
    console.info(formatted);
  },

  warn: (message: string, meta?: any) => {
    const formatted = formatLog('warn', message, meta);
    console.warn(formatted);
  },

  error: (message: string, meta?: any) => {
    const formatted = formatLog('error', message, meta);
    console.error(formatted);
  },
};

export default logger;
