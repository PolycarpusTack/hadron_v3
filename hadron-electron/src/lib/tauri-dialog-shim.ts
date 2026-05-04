export async function open(options?: {
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
  directory?: boolean
  defaultPath?: string
}): Promise<string | string[] | null> {
  const result = await window.hadron.openFile({
    multiple: options?.multiple,
    filters: options?.filters,
  })
  if (!result || result.length === 0) return null
  return options?.multiple ? result : result[0]
}

export async function save(options?: {
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}): Promise<string | null> {
  return window.hadron.saveFile(options)
}
