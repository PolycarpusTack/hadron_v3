import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'tests/**/*.test.ts'],
    alias: {
      'electron-log': new URL('./electron/__mocks__/electron-log.ts', import.meta.url).pathname,
    },
  },
})
