import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
