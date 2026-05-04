export function info(message: string): Promise<void> {
  console.info('[hadron]', message)
  return Promise.resolve()
}

export function error(message: string): Promise<void> {
  console.error('[hadron]', message)
  return Promise.resolve()
}

export function warn(message: string): Promise<void> {
  console.warn('[hadron]', message)
  return Promise.resolve()
}

export function debug(message: string): Promise<void> {
  console.debug('[hadron]', message)
  return Promise.resolve()
}

export function attachConsole(): Promise<() => void> {
  return Promise.resolve(() => {})
}
