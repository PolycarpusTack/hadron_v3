import { safeStorage } from 'electron'
import Store from 'electron-store'

const store = new Store<Record<string, string>>({ name: 'secure-storage' })

export function setSecret(service: string, account: string, password: string): void {
  const encrypted = safeStorage.encryptString(password)
  store.set(`${service}:${account}`, encrypted.toString('base64'))
}

export function getSecret(service: string, account: string): string | null {
  const encoded = store.get(`${service}:${account}`) as string | undefined
  if (!encoded) return null
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return null
  }
}

export function deleteSecret(service: string, account: string): void {
  store.delete(`${service}:${account}`)
}
