export function relaunch(): Promise<void> {
  window.hadron.relaunch()
  return Promise.resolve()
}

export function exit(code?: number): Promise<void> {
  window.hadron.exit(code)
  return Promise.resolve()
}
