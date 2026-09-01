import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Single-file build for the Netlify "Send to Netlify" import path, which takes
 * one self-contained HTML document. Code splitting is disabled and every asset
 * is inlined; scripts/inline-single.mjs then folds the JS/CSS into the HTML.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 1024,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
