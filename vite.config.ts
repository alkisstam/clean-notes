import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // Relative paths let the app be hosted at a domain root or in any sub-folder.
  base: './',
  publicDir: mode === 'android' ? false : 'public',
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
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // The Android app bundles only the note view, served from its assets.
    ...(mode === 'android' && {
      outDir: 'android/app/src/main/assets/editor',
      emptyOutDir: true,
      rollupOptions: { input: 'android.html' },
    }),
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
