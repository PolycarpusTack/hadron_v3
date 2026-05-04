export interface DragDropEvent {
  payload: {
    type: 'enter' | 'over' | 'drop' | 'leave'
    paths: string[]
    position?: { x: number; y: number }
  }
}

export function getCurrentWindow() {
  return {
    isMinimized: async () => false,
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    close: async () => {},
    setTitle: async (_title: string) => {},
    isMaximized: async () => false,
    startDragging: async () => {},
  }
}

export async function currentMonitor() {
  return {
    size: { width: window.screen.width, height: window.screen.height },
    position: { x: 0, y: 0 },
    scaleFactor: window.devicePixelRatio,
  }
}

export function getCurrentWebview() {
  return {
    setZoom: async (_factor: number) => {},
    /** Returns a Promise<unlisten> like the real Tauri API */
    onDragDropEvent: (_handler: (event: DragDropEvent) => void): Promise<() => void> => {
      // No-op in Electron — file drops are handled via HTML drag events
      return Promise.resolve(() => {})
    },
  }
}
