export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.hadron?.invoke) {
    return Promise.reject(new Error(`IPC not ready: invoke('${command}')`))
  }
  return window.hadron.invoke(command, args) as Promise<T>
}
