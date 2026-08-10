import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative asset URLs work both at / and at GitHub Pages' /phaseshift/ path.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Phase 4.6: code-splitting. Separate three into its own
        // chunk (the renderer + the post-processing); separate the
        // audio module into its own chunk. The main entry stays
        // under 200 KB gzipped for the §4.6 acceptance.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/howler') || id.includes('/src/audio/')) return 'audio';
          if (id.includes('/src/phase/lock.js') || id.includes('/src/resonance/') || id.includes('/src/collapse/') || id.includes('/src/tutorial/')) return 'gameplay';
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
