import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
