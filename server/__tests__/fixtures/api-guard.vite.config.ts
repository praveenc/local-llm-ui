// Vite config for api-guard.test.ts: the guard, one plugin route, and server.proxy and
// preview.proxy to a test upstream. Loaded by api-guard-vite.mjs in a child process.
import { defineConfig } from 'vite';

import { apiGuardPlugin } from '../../security.ts';

const target = process.env.API_GUARD_UPSTREAM;
const root = process.env.API_GUARD_ROOT;
if (!target || !root) throw new Error('Set API_GUARD_UPSTREAM and API_GUARD_ROOT');

const proxy = {
  '/api/upstream': { target, rewrite: (path: string) => path.replace(/^\/api\/upstream/, '') },
};

export default defineConfig({
  root,
  logLevel: 'silent',
  clearScreen: false,
  plugins: [
    apiGuardPlugin(),
    // A plugin route after the guard. It reads the path with new URL(), as the OpenRouter proxy
    // does, so `/./api/plugin` and `http://host/api/plugin` reach it too
    {
      name: 'sink',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const { pathname } = new URL(req.url ?? '/', 'http://localhost');
          if (pathname.startsWith('/api/plugin')) res.end('plugin');
          else next();
        });
      },
    },
  ],
  optimizeDeps: { noDiscovery: true, include: [] },
  // As in vite.config.ts
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, cors: false, proxy },
  preview: { host: '127.0.0.1', port: 0, strictPort: true, cors: false, proxy },
});
