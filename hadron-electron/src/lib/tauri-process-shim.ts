export function relaunch(): Promise<void> {
  window.hadron.relaunch()
  return Promise.resolve()
}

export function exit(code?: number): Promise<void> {
  window.hadron.invoke('app:exit', { code: code ?? 0 })
  return Promise.resolve()
}
