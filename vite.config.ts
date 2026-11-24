import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

import { createAISDKProxy } from './server/aisdk-proxy.ts';
import { createAnthropicProxy } from './server/anthropic-aisdk-proxy.ts';
import { handleBedrockAISDKRequest } from './server/bedrock-aisdk-proxy.ts';
import { handleBedrockRequest } from './server/bedrock-proxy.ts';
import { createKiroProxy } from './server/kiro-proxy.ts';
import { createLMStudioAISDKProxy } from './server/lmstudio-aisdk-proxy.ts';
import { handleLMStudioRequest } from './server/lmstudio-proxy.ts';
import { handleMantleRequest } from './server/mantle-proxy.ts';
import { createOllamaAISDKProxy } from './server/ollama-aisdk-proxy.ts';
import { createOpenRouterAISDKProxy } from './server/openrouter-aisdk-proxy.ts';
import { apiGuardPlugin } from './server/security.ts';

// No script-src or style-src: the dev server and the pre-paint script in index.html need inline code
// img-src: public/ icons, models.dev provider logos, attachments as blob: and data: URLs
export const securityHeaders = {
  'Content-Security-Policy':
    "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; img-src 'self' data: blob: https://models.dev",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  plugins: [
    // Rejects cross-site requests to /api (SEC-13). Keep it first, before every proxy
    apiGuardPlugin(),
    tailwindcss(),
    react(),
    // Bedrock proxy for AWS SDK integration
    {
      name: 'bedrock-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          // Route AI SDK requests to the new proxy
          if (req.url?.startsWith('/api/bedrock-aisdk')) {
            await handleBedrockAISDKRequest(req, res);
          } else if (req.url?.startsWith('/api/bedrock')) {
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
    // AI SDK proxy for Groq and Cerebras
    {
      name: 'aisdk-proxy',
      configureServer(server) {
        server.middlewares.use(createAISDKProxy());
      },
    },
    // Anthropic AI SDK proxy for Claude models
    {
      name: 'anthropic-aisdk-proxy',
      configureServer(server) {
        server.middlewares.use(createAnthropicProxy());
      },
    },
    // LMStudio AI SDK proxy for chat
    {
      name: 'lmstudio-aisdk-proxy',
      configureServer(server) {
        server.middlewares.use(createLMStudioAISDKProxy());
      },
    },
    // Ollama AI SDK proxy for chat
    {
      name: 'ollama-aisdk-proxy',
      configureServer(server) {
        server.middlewares.use(createOllamaAISDKProxy());
      },
    },
    // OpenRouter AI SDK proxy for models + chat
    {
      name: 'openrouter-aisdk-proxy',
      configureServer(server) {
        server.middlewares.use(createOpenRouterAISDKProxy());
      },
    },
    // Kiro CLI status, sign-in, and sign-out
    {
      name: 'kiro-proxy',
      configureServer(server) {
        const kiro = createKiroProxy();
        server.middlewares.use(kiro);
        // A sign-in that waits for approval must not outlive the server
        server.httpServer?.once('close', () => kiro.close());
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
            } catch {
              console.warn(
                '[LMStudio] Model discovery unavailable — local server is not connected.'
              );
              if (!res.headersSent) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    error:
                      'LM Studio is not connected. Start LM Studio and enable its local server.',
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
  // Vite sends these on what it serves itself (HTML, modules, public/); not on the /api proxies
  server: {
    headers: securityHeaders,
    // The app calls only its own origin. Vite's CORS middleware would answer preflights from other
    // localhost ports before the /api guard runs (SEC-13), so it stays off
    cors: false,
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
  preview: {
    headers: securityHeaders,
    cors: false,
  },
});
