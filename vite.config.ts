import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { handleBedrockRequest } from './server/bedrock-proxy';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Bedrock proxy for AWS SDK integration
    {
      name: 'bedrock-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/bedrock')) {
            await handleBedrockRequest(req, res);
          } else {
            next();
          }
        });
      },
    },
  ],
  server: {
    proxy: {
      '/api/lmstudio': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/lmstudio/, ''),
        configure: (proxy) => {
          proxy.on('error', () => {
            // Silently ignore connection errors when LMStudio is not running
          });
        },
      },
      '/api/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
        configure: (proxy) => {
          proxy.on('error', () => {
            // Silently ignore connection errors when Ollama is not running
          });
        },
      },
    },
  },
});
