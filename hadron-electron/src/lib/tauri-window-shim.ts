export async function getCurrentWindow() {
  return {
    isMinimized: async () => false,
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    close: async () => {},
    setTitle: async (_title: string) => {},
    isMaximized: async () => false,
  }
}

export async function currentMonitor() {
  return {
    size: { width: window.screen.width, height: window.screen.height },
    position: { x: 0, y: 0 },
    scaleFactor: window.devicePixelRatio,
  }
}

export async function getCurrentWebview() {
  return { setZoom: async (_factor: number) => {} }
}
