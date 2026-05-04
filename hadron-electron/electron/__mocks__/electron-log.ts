export default {
  initialize: () => {},
  info: (...args: unknown[]) => console.log('[mock-log]', ...args),
  warn: (...args: unknown[]) => console.warn('[mock-log]', ...args),
  error: (...args: unknown[]) => console.error('[mock-log]', ...args),
  transports: { file: { level: 'info' } },
}
