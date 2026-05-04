import { IpcMain, dialog, BrowserWindow } from 'electron'

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
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('dialog:saveFile', async (_e, options?: {
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, options ?? {})
    return result.canceled ? null : result.filePath
  })
}
