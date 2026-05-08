export {}

declare global {
  interface Window {
    hadron: {
      invoke<T = unknown>(channel: string, args?: unknown): Promise<T>
      openFile(options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }>; directory?: boolean; defaultPath?: string }): Promise<string[] | null>
      saveFile(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>
      onStreamChunk(callback: (chunk: string) => void): () => void
      onWidgetOpenInMain(callback: (payload: { messages?: Array<{ role: string; content: string }> }) => void): () => void
      onReleaseNotesProgress(callback: (payload: { phase: string; progress: number; message: string; requestId?: string | null }) => void): () => void
      getAppVersion(): Promise<string>
      relaunch(): void
      exit(code?: number): void
      getPath(name: string): Promise<string>
      writeToClipboard(text: string): Promise<void>
      readFromClipboard(): Promise<string>
      secret: {
        get(service: string, account: string): Promise<string | null>
        set(service: string, account: string, password: string): Promise<void>
        delete(service: string, account: string): Promise<void>
      }
    }
  }
}
