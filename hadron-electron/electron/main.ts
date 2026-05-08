import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { initDatabase } from './database'
import { registerAllHandlers } from './ipc/index'
import { preloadSavedExportDir } from './ipc/dialogAllowlist'
import { shutdownMcpClient } from './services/mcp-client'

log.initialize()
log.transports.file.level = 'info'

let mainWindow: BrowserWindow | null = null

/** Resolve a file inside the resources directory in both dev and production. */
function resourcePath(...segments: string[]): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', 'resources')
  return path.join(base, ...segments)
}

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: resourcePath('icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  splash.loadFile(resourcePath('splash.html'))
  return splash
}

function createWindow(splash: BrowserWindow | null): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Hadron',
    icon: resourcePath('icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.destroy()
    mainWindow?.show()
  })

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
  registerAllHandlers(ipcMain, () => mainWindow)

  const splash = createSplashWindow()
  createWindow(splash)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(null)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  shutdownMcpClient()
})
