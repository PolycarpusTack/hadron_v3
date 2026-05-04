export {}

declare global {
  interface Window {
    hadron: {
      invoke(channel: string, args?: unknown): Promise<unknown>
      openFile(options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[] | null>
      saveFile(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>
      writeFile(filePath: string, content: string): Promise<void>
      writeFileBytes(filePath: string, bytes: Uint8Array): Promise<void>
      onStreamChunk(callback: (chunk: string) => void): () => void
      getAppVersion(): Promise<string>
      relaunch(): void
      getPath(name: string): Promise<string>
      writeToClipboard(text: string): Promise<void>
      readFromClipboard(): Promise<string>
    }
  }
}
