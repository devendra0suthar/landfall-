import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The front end is static (docs/REQUIREMENTS.md §9): it builds to plain assets
// and talks to a regional API. In development that API is local, so proxy
// rather than hard-coding an origin into the bundle.
export default defineConfig({
  server: {
    port: 5174,
    proxy: { '/api': { target: 'http://127.0.0.1:5175', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
