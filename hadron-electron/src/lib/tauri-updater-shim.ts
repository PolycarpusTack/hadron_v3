export interface Update {
  version: string
  available: boolean
  download: () => Promise<void>
  install: () => Promise<void>
}

export async function check(): Promise<Update | null> {
  return window.hadron.invoke('updater:check') as Promise<Update | null>
}
