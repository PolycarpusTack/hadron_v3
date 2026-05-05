export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export interface Update {
  available: boolean
  currentVersion: string
  version: string
  date?: string
  body?: string
  rawJson?: Record<string, unknown>
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
}

export async function check(): Promise<Update | null> {
  const raw = await window.hadron.invoke('updater:check') as {
    available: boolean; currentVersion: string; version: string; date?: string; body?: string
  } | null
  if (!raw) return null
  return {
    ...raw,
    download: async () => { await window.hadron.invoke('updater:download-and-install') },
    install: async () => { /* handled by download-and-install combined */ },
    downloadAndInstall: async () => { await window.hadron.invoke('updater:download-and-install') },
  }
}
