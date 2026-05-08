import { IpcMain, BrowserWindow, ipcMain as electronIpcMain, app } from 'electron'
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
import { registerSentryHandlers } from './sentry'
import { registerReleaseNotesHandlers } from './release-notes'
import { registerJiraAssistHandlers } from './jira-assist'
import { registerKeeperHandlers } from './keeper'
import { registerInvestigationHandlers } from './investigation'
import { registerRagHandlers } from './rag'

export function registerAllHandlers(ipcMain: IpcMain, getMainWindow?: () => BrowserWindow | null): void {
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
  registerWidgetHandlers(ipcMain, getMainWindow ?? (() => null))
  registerChatHandlers(ipcMain)
  registerGoldAnswerHandlers(ipcMain)
  registerSummaryHandlers(ipcMain)
  registerSignatureHandlers(ipcMain)
  registerJiraHandlers(ipcMain)
  registerSentryHandlers(ipcMain)
  registerReleaseNotesHandlers(ipcMain)
  registerJiraAssistHandlers(ipcMain)
  registerKeeperHandlers(ipcMain)
  registerInvestigationHandlers(ipcMain)
  registerRagHandlers(ipcMain)

  electronIpcMain.handle('app:version', () => app.getVersion())
  electronIpcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0) })
}
