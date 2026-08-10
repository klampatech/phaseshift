import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative asset URLs work both at / and at GitHub Pages' /phaseshift/ path.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
