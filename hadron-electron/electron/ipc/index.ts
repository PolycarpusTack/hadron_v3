import { IpcMain, ipcMain as electronIpcMain, app } from 'electron'
import { registerSettingsHandlers } from './settings'
import { registerDialogHandlers } from './dialog'
import { registerAiHandlers } from './ai'
import { registerCrudHandlers } from './crud'
import { registerSearchHandlers } from './search'
import { registerTagHandlers } from './tags'
import { registerNotesHandlers } from './notes'
import { registerArchiveHandlers } from './archive'
import { registerAnalyticsHandlers } from './analytics'
import { registerBulkHandlers } from './bulk'
import { registerInfoHandlers } from './info'

export function registerAllHandlers(ipcMain: IpcMain): void {
  registerSettingsHandlers(ipcMain)
  registerDialogHandlers(ipcMain)
  registerAiHandlers(ipcMain)
  registerCrudHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerTagHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  registerArchiveHandlers(ipcMain)
  registerAnalyticsHandlers(ipcMain)
  registerBulkHandlers(ipcMain)
  registerInfoHandlers(ipcMain)

  electronIpcMain.on('app:version', (event) => { event.returnValue = app.getVersion() })
  electronIpcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0) })
}
