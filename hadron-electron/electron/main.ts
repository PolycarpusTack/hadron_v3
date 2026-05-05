import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { initDatabase } from './database'
import { registerAllHandlers } from './ipc/index'
import { preloadSavedExportDir } from './ipc/dialogAllowlist'

log.initialize()
log.transports.file.level = 'info'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Hadron',
    icon: path.join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // SECURITY: only forward https:// URLs to the OS. We re-parse via the URL
  // constructor and re-check the protocol so that crafted strings such as
  // "https://" + "javascript:..." or "https:\\\\foo" cannot smuggle a non-web
  // scheme into shell.openExternal — see Electron security best-practices.
  const safeOpenExternal = (url: string): void => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') shell.openExternal(parsed.toString())
    } catch { /* ignore malformed URLs */ }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed: URL
    try { parsed = new URL(url) } catch { event.preventDefault(); return }
    const rendererOrigin = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
      : null
    if (rendererOrigin && parsed.origin === rendererOrigin) return
    event.preventDefault()
    safeOpenExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  preloadSavedExportDir()
  initDatabase()
  registerAllHandlers(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
