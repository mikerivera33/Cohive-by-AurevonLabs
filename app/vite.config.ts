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
  },
});
