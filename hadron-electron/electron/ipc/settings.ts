import { IpcMain, app, clipboard } from 'electron'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'
import log from 'electron-log'
import fs from 'fs/promises'
import { getSecret, setSecret, deleteSecret } from '../services/safe-storage'
import { getDb } from '../database'

const stores = new Map<string, InstanceType<typeof Store>>()

function getStore(name: string): InstanceType<typeof Store> {
  if (!stores.has(name)) stores.set(name, new Store({ name }))
  return stores.get(name)!
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('store:get', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).get(key) ?? null
  })

  ipcMain.handle('store:set', (_e, { store, key, value }: { store: string; key: string; value: unknown }) => {
    getStore(store).set(key, value)
  })

  ipcMain.handle('store:delete', (_e, { store, key }: { store: string; key: string }) => {
    getStore(store).delete(key)
  })

  ipcMain.handle('store:has', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).has(key)
  })

  ipcMain.handle('store:entries', (_e, { store }: { store: string }) => {
    return Object.entries(getStore(store).store)
  })

  ipcMain.handle('keytar:get', (_e, { service, account }: { service: string; account: string }) => {
    try {
      return getSecret(service, account)
    } catch (err) {
      log.warn('keytar:get failed', err)
      return null
    }
  })

  ipcMain.handle('keytar:set', (_e, { service, account, password }: { service: string; account: string; password: string }) => {
    setSecret(service, account, password)
  })

  ipcMain.handle('keytar:delete', (_e, { service, account }: { service: string; account: string }) => {
    deleteSecret(service, account)
  })

  ipcMain.handle('app:getPath', (_e, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0])
  })

  ipcMain.handle('app:exit', (_e, { code }: { code: number }) => {
    app.exit(code)
  })

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('fs:writeFile', async (_e, { filePath, content }: { filePath: string; content: string }) => {
    await fs.writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('fs:writeFileBytes', async (_e, { filePath, bytes }: { filePath: string; bytes: number[] }) => {
    await fs.writeFile(filePath, Buffer.from(bytes))
  })

  ipcMain.handle('export_diagnostics', () => {
    const db = getDb()
    const counts = {
      analyses: (db.prepare('SELECT COUNT(*) AS c FROM analyses').get() as { c: number }).c,
      translations: (db.prepare('SELECT COUNT(*) AS c FROM translations').get() as { c: number }).c,
      chatSessions: (db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get() as { c: number }).c,
    }
    return JSON.stringify({ platform: 'electron', ...counts }, null, 2)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      autoUpdater.autoDownload = false
      const result = await autoUpdater.checkForUpdates()
      if (!result) return null
      const info = result.updateInfo
      const currentVersion = app.getVersion()
      const hasUpdate = info.version !== currentVersion
      if (!hasUpdate) return null
      return {
        available: true,
        currentVersion,
        version: info.version,
        date: info.releaseDate ?? null,
        body: Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n: { note?: string | null } | string) =>
              typeof n === 'string' ? n : (n.note ?? '')
            ).join('\n')
          : (info.releaseNotes as string | null ?? null),
      }
    } catch (err) {
      log.warn('updater:check failed:', err)
      return null
    }
  })

  ipcMain.handle('updater:download-and-install', async () => {
    try {
      await autoUpdater.downloadUpdate()
      autoUpdater.quitAndInstall()
    } catch (err) {
      log.warn('updater:download-and-install failed:', err)
      throw err
    }
  })
}
