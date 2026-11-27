// @vitest-environment node
// Coding agents read one copy of the project instructions: AGENTS.md at the root (#135).
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

describe('agent instructions', () => {
  it('live in AGENTS.md at the root', () => {
    expect(read('AGENTS.md')).toMatch(/^# AGENTS\.md\n/);
  });

  it('CLAUDE.md at the root only imports AGENTS.md', () => {
    expect(read('CLAUDE.md').trim()).toBe('@AGENTS.md');
  });

  it('have no other copy in docs/ or .kiro/steering/', () => {
    for (const dir of ['docs', '.kiro/steering']) {
      const copies = readdirSync(path.join(ROOT, dir)).filter((n) =>
        /^(CLAUDE|AGENTS)\.md$/i.test(n)
      );
      expect(copies.map((n) => `${dir}/${n}`)).toEqual([]);
    }
  });

  it('keep the git container steps, marked optional', () => {
    const text = read('AGENTS.md');
    expect(text).toContain('## Optional: git in the maintainer');
    expect(text).toContain('my-git-workspace');
    expect(existsSync(path.join(ROOT, '.kiro/steering/ui-ux-guidelines.md'))).toBe(true);
  });
});
