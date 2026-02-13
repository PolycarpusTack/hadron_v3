import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Build optimizations
  build: {
    // Target modern browsers for smaller output
    target: "es2020",
    // Generate source maps for debugging (disable in production if needed)
    sourcemap: false,
    // Rollup optimizations
    rollupOptions: {
      output: {
        // Manual chunks for better caching
        manualChunks: {
          // Vendor chunk: React and core libraries
          vendor: ["react", "react-dom"],
          // UI chunk: icons and UI components
          ui: ["lucide-react"],
          // Date utilities
          "date-utils": ["date-fns"],
        },
      },
    },
    // Chunk size warnings threshold
    chunkSizeWarningLimit: 500,
  },

  // Vitest configuration
  test: {
    globals: true,
    // Exclude e2e tests - they use Playwright
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/e2e/**",
      "**/*.spec.ts",
    ],
  },
}));
