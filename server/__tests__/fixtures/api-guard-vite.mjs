// Starts real Vite servers for api-guard.test.ts and prints one line:
//   API_GUARD_READY {"dev":…,"preview":…,"app":…,"order":[…]}
// - dev and preview: api-guard.vite.config.ts, the guard with a test upstream.
// - app: the app's own vite.config.ts, with no HMR and no dependency scan.
// - order: the plugins with configureServer, in the order Vite runs them.
// Vite cannot start inside the Vitest VM pool, so the test runs this file with node. It stops when
// stdin closes or on SIGTERM.
import { fileURLToPath } from 'url';
import { createServer, preview } from 'vite';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const fixtureConfig = here('./api-guard.vite.config.ts');
const appConfig = here('../../../vite.config.ts');

const dev = await createServer({ configFile: fixtureConfig });
await dev.listen();
const prev = await preview({ configFile: fixtureConfig });
const app = await createServer({
  configFile: appConfig,
  logLevel: 'silent',
  clearScreen: false,
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await app.listen();

const portOf = (server) => server.httpServer.address().port;
const order = app.config.getSortedPlugins('configureServer').map((plugin) => plugin.name);
process.stdout.write(
  `API_GUARD_READY ${JSON.stringify({ dev: portOf(dev), preview: portOf(prev), app: portOf(app), order })}\n`
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([dev.close(), prev.close(), app.close()]);
  process.exit(0);
}
process.stdin.on('end', stop);
process.stdin.resume();
process.on('SIGTERM', stop);
