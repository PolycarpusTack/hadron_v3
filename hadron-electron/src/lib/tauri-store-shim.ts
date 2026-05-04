export interface StoreOptions {
  autoSave?: boolean
}

export class Store {
  private storeName: string

  constructor(storeName: string, _opts?: StoreOptions) {
    this.storeName = storeName
  }

  async get<T>(key: string): Promise<T | null> {
    return window.hadron.invoke('store:get', { store: this.storeName, key }) as Promise<T | null>
  }

  async set(key: string, value: unknown): Promise<void> {
    await window.hadron.invoke('store:set', { store: this.storeName, key, value })
  }

  async delete(key: string): Promise<void> {
    await window.hadron.invoke('store:delete', { store: this.storeName, key })
  }

  async has(key: string): Promise<boolean> {
    return window.hadron.invoke('store:has', { store: this.storeName, key }) as Promise<boolean>
  }

  async save(): Promise<void> {
    // electron-store auto-saves; this is a no-op
  }

  async entries<T>(): Promise<Array<[string, T]>> {
    return window.hadron.invoke('store:entries', { store: this.storeName }) as Promise<Array<[string, T]>>
  }
}

export async function load(storeName: string, opts?: StoreOptions): Promise<Store> {
  return new Store(storeName, opts)
}
