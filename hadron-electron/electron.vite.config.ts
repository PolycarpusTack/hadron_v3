import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve('electron/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve('electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.cjs'
      }
    }
  },
  renderer: {
    root: 'src',
    publicDir: resolve('src/public'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          main: resolve('src/index.html'),
          widget: resolve('src/widget.html'),
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@tauri-apps/api/core':    resolve('src/lib/tauri-core-shim.ts'),
        '@tauri-apps/api/event':   resolve('src/lib/tauri-event-shim.ts'),
        '@tauri-apps/api/window':  resolve('src/lib/tauri-window-shim.ts'),
        '@tauri-apps/api/webview': resolve('src/lib/tauri-window-shim.ts'),
        '@tauri-apps/api/path':    resolve('src/lib/tauri-path-shim.ts'),
        '@tauri-apps/plugin-dialog':            resolve('src/lib/tauri-dialog-shim.ts'),
        '@tauri-apps/plugin-log':               resolve('src/lib/tauri-log-shim.ts'),
        '@tauri-apps/plugin-store':             resolve('src/lib/tauri-store-shim.ts'),
        '@tauri-apps/plugin-updater':           resolve('src/lib/tauri-updater-shim.ts'),
        '@tauri-apps/plugin-process':           resolve('src/lib/tauri-process-shim.ts'),
        '@tauri-apps/plugin-clipboard-manager': resolve('src/lib/tauri-clipboard-shim.ts'),
      }
    }
  }
})
