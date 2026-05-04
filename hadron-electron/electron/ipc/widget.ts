import { IpcMain, BrowserWindow } from 'electron'

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export function registerWidgetHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('focus_main_window', () => {
    const win = getMainWindow()
    if (win) { win.show(); win.restore(); win.focus() }
  })
  ipcMain.handle('show_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('hide_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('toggle_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('resize_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('move_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('get_widget_position', () => ({ x: 0, y: 0 }))
  ipcMain.handle('is_widget_visible', () => false)
  ipcMain.handle('is_main_window_visible', () => {
    const win = getMainWindow()
    return win ? win.isVisible() && !win.isMinimized() : false
  })
  ipcMain.handle('set_hover_button_enabled', () => { /* no-op */ })
}
