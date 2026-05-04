export async function join(...paths: string[]): Promise<string> {
  // In renderer context, path joining via simple string concat is fine for display
  return paths.filter(Boolean).join('/')
}

export async function appDataDir(): Promise<string> {
  return window.hadron.getPath('userData')
}

export async function appLogDir(): Promise<string> {
  return window.hadron.getPath('logs')
}
