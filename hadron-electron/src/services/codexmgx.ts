import { invoke } from '../lib/tauri-core-shim'

export interface CodexMgXConfig {
  scriptPath: string
  enabled: boolean
}

const DEFAULT_SCRIPT_PATH = 'C:\\whatsOn\\CodexMgX plugin\\plugins\\codexmgx-plugin\\scripts\\start-codexmgx-mcp.ps1'

export async function getCodexMgXConfig(): Promise<CodexMgXConfig> {
  try {
    return await invoke<CodexMgXConfig>('get_codexmgx_config')
  } catch {
    return { scriptPath: DEFAULT_SCRIPT_PATH, enabled: false }
  }
}

export async function saveCodexMgXConfig(config: CodexMgXConfig): Promise<void> {
  await invoke<void>('save_codexmgx_config', config as unknown as Record<string, unknown>)
}
