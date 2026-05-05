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
    width: 56,
    height: 56,
    x: screenW - 80,
    y: screenH - 80,
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

  ipcMain.handle('resize_widget', (_e, args: { width: number; height: number }) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setSize(args.width, args.height, false)
    }
  })

  ipcMain.handle('move_widget', (_e, args: { x: number; y: number }) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setPosition(Math.round(args.x), Math.round(args.y), false)
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
