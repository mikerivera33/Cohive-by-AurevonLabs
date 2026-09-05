import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `vite preview` inherits `server.proxy`. When the API on :8080 is down (CI /
 * smoke against static dist), proxied `/api/*` returns 502 and Chromium logs
 * console errors that fail the smoke suite. Short-circuit in preview with a
 * quiet 200 so `apiHealthy()` can read `{ ok: false }` without a console error.
 * Dev (`vite`) still proxies to the real API.
 */
function previewApiOffline(): Plugin {
  return {
    name: 'cohive-preview-api-offline',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api')) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: false, reason: 'preview-static' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), previewApiOffline()],
  build: {
    // Capacitor copies this directory into the native projects.
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Local API (npm run api) — real ACL path during development.
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
