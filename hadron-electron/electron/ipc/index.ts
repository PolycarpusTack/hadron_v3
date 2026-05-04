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
import { registerExportHandlers } from './export'
import { registerWidgetHandlers } from './widget'
import { registerChatHandlers } from './chat'
import { registerGoldAnswerHandlers } from './gold-answers'
import { registerSummaryHandlers } from './summaries'
import { registerSignatureHandlers } from './signatures'
import { registerJiraHandlers } from './jira'

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
  registerExportHandlers(ipcMain)
  registerWidgetHandlers(ipcMain)
  registerChatHandlers(ipcMain)
  registerGoldAnswerHandlers(ipcMain)
  registerSummaryHandlers(ipcMain)
  registerSignatureHandlers(ipcMain)
  registerJiraHandlers(ipcMain)

  electronIpcMain.handle('app:version', () => app.getVersion())
  electronIpcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0) })
}
