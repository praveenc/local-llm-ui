// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { MCPStdioConfig } from '../../src/types/mcp';
import { closeAllMCPClients, getMCPServerStatus } from '../mcp-manager';

const FIXTURE = fileURLToPath(new URL('./fixtures/slow-mcp-server.mjs', import.meta.url));

/** Longer than the 1 s that the AI SDK waits for `server/discover` on stdio */
const SLOW_START_MS = 1500;

const slowServer = (id: string, mode: 'modern' | 'legacy'): MCPStdioConfig => ({
  id,
  name: id,
  enabled: true,
  transport: 'stdio',
  command: 'node',
  args: [FIXTURE, String(SLOW_START_MS), mode],
  env: {},
});

afterEach(async () => {
  await closeAllMCPClients();
});

describe('getMCPServerStatus with a slow stdio server', () => {
  it('connects to a 2026-07-28 server that answers server/discover after 1 s', async () => {
    const [status] = await getMCPServerStatus([slowServer('slow-modern', 'modern')]);

    expect(status).toEqual({
      name: 'slow-modern',
      id: 'slow-modern',
      status: 'connected',
      tools: ['echo'],
    });
  }, 10_000);

  it('falls back to initialize for a legacy server that rejects server/discover', async () => {
    const [status] = await getMCPServerStatus([slowServer('slow-legacy', 'legacy')]);

    expect(status).toEqual({
      name: 'slow-legacy',
      id: 'slow-legacy',
      status: 'connected',
      tools: ['echo'],
    });
  }, 10_000);
});
