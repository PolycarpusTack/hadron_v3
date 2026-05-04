import { IpcMain } from 'electron'

const NOT_AVAILABLE_MSG = 'Keeper Secrets Manager requires the Tauri desktop build'

export function registerKeeperHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('initialize_keeper', () => ({
    success: false,
    message: NOT_AVAILABLE_MSG,
    secrets_count: 0,
  }))

  ipcMain.handle('list_keeper_secrets', () => ({
    success: false,
    secrets: [],
    message: NOT_AVAILABLE_MSG,
  }))

  ipcMain.handle('get_keeper_status', () => ({
    configured: false,
    connected: false,
    secrets_count: 0,
    message: NOT_AVAILABLE_MSG,
  }))

  ipcMain.handle('clear_keeper_config', () => {})

  ipcMain.handle('test_keeper_connection', () => ({
    success: false,
    secrets: [],
    message: NOT_AVAILABLE_MSG,
  }))
}
