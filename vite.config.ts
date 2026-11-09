import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // Relative paths let the app be hosted at a domain root or in any sub-folder.
  base: './',
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'desktop' || mode === 'android',
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        id: './',
        name: 'Clean Notes',
        short_name: 'Notes',
        description: 'Notebooks, nested tags, daily notes, tasks and PDFs. Stored on your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#f5f2eb',
        theme_color: '#f5f2eb',
        categories: ['productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        share_target: {
          action: './?open=share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['image/*', 'application/pdf', 'text/plain'] }] },
        },
        shortcuts: [
          { name: "Today's note", url: './?open=today', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'New note', url: './?open=new', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Tasks', url: './?open=tasks', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm,bcmap,pfb,ttf,icc}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        importScripts: ['share-target.js'],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // The Android app bundles only the note view, served from its assets.
    ...(mode === 'android' && { outDir: 'android/app/src/main/assets/editor', emptyOutDir: true }),
    rollupOptions: {
      ...(mode === 'android' && { input: 'android.html' }),
      output: {
        // pdf.js runs its worker as a module, and browsers refuse a module served as anything but JavaScript.
        // Many servers (nginx included) send .mjs as application/octet-stream, so the worker ships as .js.
        assetFileNames: (asset) =>
          (asset.names?.[0] ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
