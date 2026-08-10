import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Vite's dep pre-bundling would strip the .wasm asset that
    // onnxruntime-web loads relative to its own module URL.
    exclude: ['onnxruntime-web'],
  },
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
