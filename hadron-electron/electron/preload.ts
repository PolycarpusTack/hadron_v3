import { contextBridge, ipcRenderer } from 'electron'

// Channels that must use their dedicated typed API — not callable via generic invoke.
const INVOKE_BLOCKLIST = new Set([
  'app:exit',
  'keytar:get', 'keytar:set', 'keytar:delete',
])

contextBridge.exposeInMainWorld('hadron', {
  invoke: (channel: string, args?: unknown): Promise<unknown> => {
    if (INVOKE_BLOCKLIST.has(channel)) {
      return Promise.reject(new Error(`Channel "${channel}" must use its dedicated typed API`))
    }
    return ipcRenderer.invoke(channel, args)
  },

  openFile: (options?: Electron.OpenDialogOptions): Promise<string[] | null> =>
    ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (options?: Electron.SaveDialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', options),

  onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string): void => callback(chunk)
    ipcRenderer.on('stream:chunk', handler)
    return () => ipcRenderer.removeListener('stream:chunk', handler)
  },

  onWidgetOpenInMain: (callback: (payload: { messages?: Array<{ role: string; content: string }> }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { messages?: Array<{ role: string; content: string }> }): void => callback(payload)
    ipcRenderer.on('widget:open-in-main', handler)
    return () => ipcRenderer.removeListener('widget:open-in-main', handler)
  },

  onReleaseNotesProgress: (callback: (payload: { phase: string; progress: number; message: string; requestId?: string | null }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { phase: string; progress: number; message: string; requestId?: string | null }): void => callback(payload)
    ipcRenderer.on('release-notes-progress', handler)
    return () => ipcRenderer.removeListener('release-notes-progress', handler)
  },

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  relaunch: (): void => ipcRenderer.send('app:relaunch'),
  exit: (code?: number): void => { ipcRenderer.send('app:exit', { code: code ?? 0 }) },
  getPath: (name: string): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  writeToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  readFromClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  secret: {
    get: (service: string, account: string): Promise<string | null> =>
      ipcRenderer.invoke('keytar:get', { service, account }) as Promise<string | null>,
    set: (service: string, account: string, password: string): Promise<void> =>
      ipcRenderer.invoke('keytar:set', { service, account, password }),
    delete: (service: string, account: string): Promise<void> =>
      ipcRenderer.invoke('keytar:delete', { service, account }),
  },
})
