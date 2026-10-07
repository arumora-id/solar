import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { solarServiceWorker } from './pwa/plugin.ts';

// The UI talks to the SOLAR server under /api. In development Vite proxies it to the server.
const apiTarget = process.env.SOLAR_API_URL ?? 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [react(), solarServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
