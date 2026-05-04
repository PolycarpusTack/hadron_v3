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
  return window.hadron.invoke('updater:check') as Promise<Update | null>
}
