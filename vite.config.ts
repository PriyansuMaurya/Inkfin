import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
    // The only renderer is the ever-green WebView2 runtime.
    target: 'chrome120',
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
