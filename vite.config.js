import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'esnext',  // needed for top-level await in worker
  },
  worker: {
    format: 'es',      // use ES module workers
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],  // don't bundle — it loads its own WASM
  },
})
