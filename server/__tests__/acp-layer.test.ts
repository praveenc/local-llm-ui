// @vitest-environment node
// The generic ACP layer stays free of product names and of imports from outside its folder.
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../acp');
const BUILTINS = new Set(['child_process', 'crypto', 'fs', 'fs/promises', 'path', 'stream']);
const PRODUCT = new RegExp(['k', 'i', 'r', 'o'].join(''), 'i');

async function files() {
  const names = (await readdir(DIR)).filter((n) => n.endsWith('.ts'));
  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(path.join(DIR, name), 'utf8') }))
  );
}

describe('server/acp', () => {
  it('has files', async () => {
    expect((await files()).map((f) => f.name)).toEqual(
      expect.arrayContaining(['agent.ts', 'client.ts', 'harness.ts', 'updates.ts'])
    );
  });

  it('names no product', async () => {
    for (const { name, text } of await files()) {
      expect(PRODUCT.test(text) ? name : '').toBe('');
    }
  });

  it('imports only from its own folder and from Node', async () => {
    for (const { name, text } of await files()) {
      const specifiers = [...text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)].map(
        (m) => m[1] ?? m[2]
      );
      for (const specifier of specifiers) {
        const ok = specifier.startsWith('./') || BUILTINS.has(specifier.replace(/^node:/, ''));
        expect(ok ? '' : `${name}: ${specifier}`).toBe('');
      }
    }
  });
});
