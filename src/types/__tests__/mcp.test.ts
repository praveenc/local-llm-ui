import { describe, expect, it } from 'vitest';

import { validateMCPServerConfig } from '../mcp';
import type { MCPStdioConfig } from '../mcp';

const local = (args: string[]): MCPStdioConfig => ({
  id: 'a',
  name: 'a',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args,
  env: {},
});

describe('validateMCPServerConfig', () => {
  it('refuses an argument with ; and names it by number, not by value', () => {
    expect(validateMCPServerConfig(local(['-y', 'pkg;rm']))).toBe(
      'Argument 2 contains characters that the app does not allow'
    );
  });

  it('takes plain arguments', () => {
    expect(validateMCPServerConfig(local(['-y', '@scope/pkg', '--port=3000']))).toBeNull();
  });
});
