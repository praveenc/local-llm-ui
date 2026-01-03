import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

import { handleBedrockRequest } from './server/bedrock-proxy';
import { handleLMStudioRequest } from './server/lmstudio-proxy';
import { handleMantleRequest } from './server/mantle-proxy';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        styleguide: resolve(__dirname, 'styleguide.html'),
        'styleguide-shadcn': resolve(__dirname, 'styleguide-shadcn.html'),
      },
    },
  },
  plugins: [
    tailwindcss(),
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
    // Bedrock Mantle proxy for OpenAI-compatible endpoints
    {
      name: 'mantle-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/mantle')) {
            await handleMantleRequest(req, res);
          } else {
            next();
          }
        });
      },
    },
    // LMStudio SDK proxy for model management
    {
      name: 'lmstudio-sdk-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/lmstudio-sdk')) {
            try {
              await handleLMStudioRequest(req, res);
            } catch (error) {
              console.error('LMStudio SDK proxy unhandled error:', error);
              if (!res.headersSent) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    error:
                      'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled.',
                    errorType: 'ConnectionError',
                  })
                );
              }
            }
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
