import { IpcMain, BrowserWindow, screen } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'

let widgetWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find(w => w !== widgetWindow) ?? null
}

function getOrCreateWidgetWindow(): BrowserWindow {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

  widgetWindow = new BrowserWindow({
    width: 68,
    height: 68,
    x: screenW - 84,
    y: screenH - 84,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    widgetWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/widget.html`)
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../renderer/widget.html'))
  }

  widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
    // SECURITY: re-parse the URL and re-check the protocol so a string that
    // merely starts with "https://" cannot smuggle a non-web scheme into
    // shell.openExternal. Mirrors the safeOpenExternal pattern in main.ts.
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') {
        const { shell } = require('electron') as typeof import('electron')
        shell.openExternal(parsed.toString())
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' }
  })
  widgetWindow.webContents.on('will-navigate', (event: Electron.Event) => {
    event.preventDefault()
  })

  widgetWindow.on('closed', () => { widgetWindow = null })

  return widgetWindow
}

export function registerWidgetHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('focus_main_window', () => {
    const win = getMainWindow()
    if (win) { win.show(); win.restore(); win.focus() }
  })

  ipcMain.handle('show_widget', () => {
    const win = getOrCreateWidgetWindow()
    win.show()
  })

  ipcMain.handle('hide_widget', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide()
  })

  ipcMain.handle('toggle_widget', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      getOrCreateWidgetWindow().show()
    } else if (widgetWindow.isVisible()) {
      widgetWindow.hide()
    } else {
      widgetWindow.show()
    }
  })

  // SECURITY: clamp renderer-supplied geometry. Without these guards a
  // compromised renderer could pass NaN, Infinity, negative or absurdly
  // large values into the native window APIs, crashing the process or
  // hiding the widget off-screen permanently.
  const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
  }

  ipcMain.handle('resize_widget', (_e, args: { width: number; height: number }) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const w = clampInt(args?.width, 32, 800, 68)
      const h = clampInt(args?.height, 32, 800, 68)
      widgetWindow.setSize(w, h, false)
    }
  })

  ipcMain.handle('move_widget', (_e, args: { x: number; y: number }) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
      const x = clampInt(args?.x, -screenW, screenW * 2, screenW - 80)
      const y = clampInt(args?.y, -screenH, screenH * 2, screenH - 80)
      widgetWindow.setPosition(x, y, false)
    }
  })

  ipcMain.handle('get_widget_position', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition()
      return { x, y }
    }
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
    return { x: screenW - 80, y: screenH - 80 }
  })

  ipcMain.handle('is_widget_visible', () => {
    return widgetWindow !== null && !widgetWindow.isDestroyed() && widgetWindow.isVisible()
  })

  ipcMain.handle('is_main_window_visible', () => {
    const win = getMainWindow()
    return win ? win.isVisible() && !win.isMinimized() : false
  })

  ipcMain.handle('set_hover_button_enabled', (_e, args: { enabled: boolean } | boolean) => {
    const enabled = typeof args === 'boolean' ? args : (args as { enabled: boolean }).enabled
    if (enabled) {
      getOrCreateWidgetWindow().show()
    } else if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.hide()
    }
  })
}
