export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return window.hadron.invoke(command, args) as Promise<T>
}
