// In-process event bus bridging the Tauri event API shape.
// Renderer-to-renderer events (jira:sync, settings:*, widget:*) are dispatched
// within the same renderer process via a simple Map-based bus.

export type UnlistenFn = () => void

type HandlerFn<T = unknown> = (event: { payload: T }) => void
const _bus = new Map<string, Set<HandlerFn>>()

export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!_bus.has(event)) _bus.set(event, new Set())
  const handlers = _bus.get(event)!
  handlers.add(handler as HandlerFn)
  return Promise.resolve(() => {
    handlers.delete(handler as HandlerFn)
  })
}

export function emit(event: string, payload?: unknown): Promise<void> {
  const handlers = _bus.get(event)
  if (handlers) {
    for (const h of handlers) {
      try { h({ payload }) } catch { /* isolate handler errors */ }
    }
  }
  return Promise.resolve()
}
