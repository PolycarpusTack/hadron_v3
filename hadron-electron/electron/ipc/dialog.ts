import { IpcMain, dialog, BrowserWindow } from 'electron'
import { allowDirectory, allowExactPath } from './dialogAllowlist' // allowExactPath used by saveFile

export function registerDialogHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('dialog:openFile', async (_e, options?: {
    multiple?: boolean
    filters?: Array<{ name: string; extensions: string[] }>
    directory?: boolean
    defaultPath?: string
  }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const props: Array<'openFile' | 'openDirectory' | 'multiSelections'> = options?.directory
      ? ['openDirectory']
      : ['openFile']
    if (options?.multiple) props.push('multiSelections')

    const result = await dialog.showOpenDialog(win!, {
      properties: props,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
    })
    if (result.canceled) return null
    // Only directory picks authorise writes; opening a file for reading does not.
    if (options?.directory) {
      for (const p of result.filePaths) allowDirectory(p)
    }
    return result.filePaths
  })

  ipcMain.handle('dialog:saveFile', async (_e, options?: {
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, options ?? {})
    if (result.canceled || !result.filePath) return null
    allowExactPath(result.filePath)
    return result.filePath
  })
}
