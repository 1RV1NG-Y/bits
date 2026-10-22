import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Shared UI for the sync prototype: loaded by the Electron prototype window and
// bundled into the Android (Tauri) app.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5175, strictPort: true, host: '127.0.0.1' },
});
