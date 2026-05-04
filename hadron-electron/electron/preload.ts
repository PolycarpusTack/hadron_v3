import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hadron', {
  invoke: (channel: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, args),

  openFile: (options?: Electron.OpenDialogOptions): Promise<string[] | null> =>
    ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (options?: Electron.SaveDialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', options),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', { filePath, content }),

  writeFileBytes: (filePath: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('fs:writeFileBytes', { filePath, bytes: Array.from(bytes) }),

  onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string): void => callback(chunk)
    ipcRenderer.on('stream:chunk', handler)
    return () => ipcRenderer.removeListener('stream:chunk', handler)
  },

  getAppVersion: (): string => ipcRenderer.sendSync('app:version'),
  relaunch: (): void => ipcRenderer.send('app:relaunch'),
  getPath: (name: string): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  writeToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  readFromClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read')
})
