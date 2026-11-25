// @vitest-environment node
import { createHash } from 'crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findKiroSessionCwd } from '../kiro/session-files.ts';

const ID = 'sess_11111111-2222-4333-8444-555555555555';
const OTHER = 'sess_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const bucketOf = (cwd: string) => createHash('sha256').update(cwd).digest('hex').slice(0, 16);

let home: string;

async function writeSession(bucket: string, id: string, json: unknown) {
  const dir = path.join(home, '.kiro', 'sessions', bucket, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'session.json'),
    typeof json === 'string' ? json : JSON.stringify(json)
  );
}

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'kiro-session-files-'));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('findKiroSessionCwd', () => {
  it('returns undefined when there is no sessions folder', async () => {
    expect(await findKiroSessionCwd(ID, { home })).toBeUndefined();
  });

  it('finds the folder of a session in its bucket', async () => {
    const cwd = '/work/project-a';
    await writeSession('0123456789abcdef', OTHER, { id: OTHER, workspacePaths: ['/x'] });
    await writeSession(bucketOf(cwd), ID, { id: ID, workspacePaths: [cwd], rootPaths: ['/y'] });
    expect(await findKiroSessionCwd(ID, { home })).toBe(cwd);
  });

  it('uses rootPaths when there are no workspacePaths', async () => {
    const cwd = '/work/project-b';
    const id = 'sess_22222222-2222-4333-8444-555555555555';
    await writeSession(bucketOf(cwd), id, { id, rootPaths: [cwd] });
    expect(await findKiroSessionCwd(id, { home })).toBe(cwd);
  });

  it('rejects an id that is not a Kiro session id', async () => {
    await writeSession(bucketOf('/work/c'), '..', { id: '..', workspacePaths: ['/work/c'] });
    expect(await findKiroSessionCwd('..', { home })).toBeUndefined();
    expect(await findKiroSessionCwd(`${ID}/../x`, { home })).toBeUndefined();
    expect(await findKiroSessionCwd('sess_not-a-uuid', { home })).toBeUndefined();
  });

  it('rejects a folder that does not hash to its bucket', async () => {
    const id = 'sess_33333333-2222-4333-8444-555555555555';
    await writeSession(bucketOf('/work/real'), id, { id, workspacePaths: ['/etc'] });
    expect(await findKiroSessionCwd(id, { home })).toBeUndefined();
  });

  it('skips a file larger than 1 MB in bytes, also when it has fewer characters', async () => {
    const cwd = '/work/project-big';
    const id = 'sess_55555555-2222-4333-8444-555555555555';
    // About 600K characters, but 1.8 MB in UTF-8
    await writeSession(bucketOf(cwd), id, { id, workspacePaths: [cwd], pad: 'é€'.repeat(300_000) });
    expect(await findKiroSessionCwd(id, { home })).toBeUndefined();
  });

  it('rejects a file that names another session', async () => {
    const cwd = '/work/project-d';
    const id = 'sess_44444444-2222-4333-8444-555555555555';
    await writeSession(bucketOf(cwd), id, { id: OTHER, workspacePaths: [cwd] });
    expect(await findKiroSessionCwd(id, { home })).toBeUndefined();
  });

  it('rejects a relative folder, a bad file, and a folder that is not a bucket', async () => {
    const id = 'sess_55555555-2222-4333-8444-555555555555';
    await writeSession(bucketOf('rel/dir'), id, { id, workspacePaths: ['rel/dir'] });
    const id2 = 'sess_66666666-2222-4333-8444-555555555555';
    await writeSession(bucketOf('/work/e'), id2, '{not json');
    const id3 = 'sess_77777777-2222-4333-8444-555555555555';
    await writeSession('not-a-bucket', id3, { id: id3, workspacePaths: ['/work/f'] });
    expect(await findKiroSessionCwd(id, { home })).toBeUndefined();
    expect(await findKiroSessionCwd(id2, { home })).toBeUndefined();
    expect(await findKiroSessionCwd(id3, { home })).toBeUndefined();
  });

  it('returns undefined for a session that is not on disk', async () => {
    expect(
      await findKiroSessionCwd('sess_99999999-2222-4333-8444-555555555555', { home })
    ).toBeUndefined();
  });
});
