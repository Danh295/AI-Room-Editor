import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev, so the browser never has to think about CORS and the
    // API key stays on the server side of the wall.
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: the server binds to IPv4 loopback, and on
        // a machine where localhost resolves to ::1 first, Node's fetch tries
        // that address only and every proxied call comes back 502.
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // @room/shared is a linked workspace of raw TypeScript; let Vite compile it
    // from source instead of trying to pre-bundle it as a published dependency.
    exclude: ['@room/shared'],
  },
});
