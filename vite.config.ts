import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * WebView2 is Chromium on Windows; WKWebView tracks Safari on macOS. The Tauri
 * CLI sets `TAURI_ENV_PLATFORM` for builds, so each bundle only transplies to
 * the engine it will actually run in.
 */
const tauriPlatform = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.TAURI_ENV_PLATFORM;
const buildTarget = tauriPlatform === 'darwin' ? 'safari17' : 'chrome120';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri owns the terminal during `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: buildTarget,
    // Vite 8 minifies with oxc; esbuild is no longer bundled.
    minify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    restoreMocks: true,
  },
});
