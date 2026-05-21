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

  // === Widget Lifecycle Coordination ===
  // Track whether widget was visible before minimize to restore it on restore
  let widgetWasVisibleBeforeMinimize = false

  const getWidgetWindow = () => {
    const allWins = BrowserWindow.getAllWindows()
    return allWins.find(w => {
      try {
        return w.webContents.getURL().includes('widget.html')
      } catch {
        return false
      }
    })
  }

  mainWindow.on('minimize', () => {
    log.debug('[main] Window minimized, hiding widget to prevent white square')
    mainWindow?.webContents.send('app:window-state-changed', { state: 'minimized' })
    const widgetWindow = getWidgetWindow()
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWasVisibleBeforeMinimize = widgetWindow.isVisible()
      widgetWindow.hide()
    }
  })

  mainWindow.on('restore', () => {
    log.debug('[main] Window restored, restoring widget if it was visible before minimize')
    mainWindow?.webContents.send('app:window-state-changed', { state: 'restored' })
    if (widgetWasVisibleBeforeMinimize) {
      const widgetWindow = getWidgetWindow()
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.show()
      }
    }
  })

  mainWindow.on('close', () => {
    log.debug('[main] Main window closing, cleaning up widget')
    const widgetWindow = getWidgetWindow()
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.close()
    }
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
  log.debug('[main] App quitting, cleaning up widget and MCP')
  shutdownMcpClient()
  // Ensure widget window is destroyed before quit
  const allWins = BrowserWindow.getAllWindows()
  const widgetWindow = allWins.find(w => {
    try {
      return w.webContents.getURL().includes('widget.html')
    } catch {
      return false
    }
  })
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.destroy()
  }
})
