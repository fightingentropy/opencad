import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor: split heavy third-party libs into their own chunks so
          // they cache independently of app code and lazy-load with the
          // features that need them.
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/jspdf')) return 'jspdf';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/zustand')) return 'zustand';
          if (id.includes('node_modules/nanoid')) return 'vendor-misc';
          // Collaboration: Yjs + y-webrtc + y-indexeddb + y-protocols
          // ride together in a deferred chunk that's only fetched when
          // the user opens the Collaboration modal. Single-player never
          // pays the bundle cost.
          if (
            id.includes('node_modules/yjs') ||
            id.includes('node_modules/y-webrtc') ||
            id.includes('node_modules/y-indexeddb') ||
            id.includes('node_modules/y-protocols') ||
            id.includes('node_modules/lib0') ||
            id.includes('node_modules/simple-peer')
          ) return 'collab';
          if (id.includes('/src/collab/yjs-doc') ||
              id.includes('/src/collab/sync') ||
              id.includes('/src/collab/presence') ||
              id.includes('/src/collab/session') ||
              id.includes('/src/collab/index')) return 'collab';
          // App: pull the static-data heavyweights out of the main chunk.
          if (id.includes('/src/symbols/library')) return 'symbols-library';
          if (id.includes('/src/data/catalogues')) return 'catalogues';
          // IO: file format parsers/exporters used only when the user
          // hits Import or Export. Each is a few hundred lines and rarely
          // touched, so they ride together in a deferred chunk.
          if (id.includes('/src/io/ifc-')) return 'io-ifc';
          if (id.includes('/src/io/dxf-')) return 'io-dxf';
          if (id.includes('/src/io/cobie') || id.includes('/src/io/xlsx')) return 'io-tabular';
          // Drawing details / view generators — used only on demand.
          if (id.includes('/src/views/')) return 'views';
          if (id.includes('/src/drawing/details/')) return 'details';
        },
      },
    },
  },
});
