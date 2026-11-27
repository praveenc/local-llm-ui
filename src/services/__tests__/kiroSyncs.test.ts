import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import { KIRO_COUNT_ONLY_SKIP, type KiroSessionOpenResponse } from '../../utils/kiroSessions';
import { replyStore } from '../../utils/replyStore';
import { importKiroSession } from '../kiroImport';
import {
  KIRO_CHECK_STATUS_DELAY_MS,
  prepareKiroSend,
  runningKiroSync,
  syncKiroChatOnOpen,
  trackKiroSync,
} from '../kiroSyncs';

const service = vi.hoisted(() => ({
  openSession: vi.fn(),
  checkSession: vi.fn(),
}));
vi.mock('../kiro', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../kiro')>()),
  kiroService: service,
}));

const SESSION = 'sess_5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const AT = '2026-11-25T10:00:00.000Z';
const LATER = '2026-11-25T10:05:00.000Z';

function gate() {
  let open: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

const answer = (turns: string[], skip: number, updatedAt = LATER): KiroSessionOpenResponse => ({
  title: 'Session',
  updatedAt,
  messages: turns.slice(skip).flatMap((t) => [
    { role: 'user' as const, content: t },
    { role: 'assistant' as const, content: `${t}!` },
  ]),
  turns: turns.length,
  imagesLeftOut: 0,
  turnsLeftOut: 0,
});

/** A chat that holds the turn "one" of SESSION, synced at AT */
async function chat(kiro: { turns?: number; updatedAt?: string } = { turns: 1, updatedAt: AT }) {
  const id = await importKiroSession(SESSION, answer(['one'], 0, AT), { id: 'auto', name: 'auto' });
  const stored = (await db.conversations.get(id))!.kiro!;
  await db.conversations.update(id, {
    kiro: { ...stored, turns: kiro.turns, updatedAt: kiro.updatedAt },
  });
  return id;
}

const contents = async (id: string) =>
  (await db.messages.where('conversationId').equals(id).sortBy('sequence')).map((m) => m.content);

beforeEach(async () => {
  await db.conversations.clear();
  await db.messages.clear();
  service.openSession.mockReset();
  service.checkSession.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('kiroSyncs', () => {
  it('keeps a sync until it ends, and never rejects', async () => {
    const work = gate();
    void trackKiroSync('c1', work.promise);
    const running = runningKiroSync('c1');
    expect(running).toBeDefined();
    expect(runningKiroSync('c2')).toBeUndefined();
    work.fail(new Error('no'));
    await expect(running).resolves.toBeUndefined();
    await Promise.resolve();
    expect(runningKiroSync('c1')).toBeUndefined();
  });

  it('waits for the first sync when a second one ends first', async () => {
    const first = gate();
    void trackKiroSync('c3', first.promise);
    void trackKiroSync('c3', Promise.resolve());
    await Promise.resolve();
    const running = runningKiroSync('c3');
    expect(running).toBeDefined();
    let ended = false;
    void running!.then(() => {
      ended = true;
    });
    await Promise.resolve();
    expect(ended).toBe(false);
    first.open();
    await running;
    expect(ended).toBe(true);
  });
});

describe('prepareKiroSend (K11)', () => {
  it('ends at once for a chat that has no Kiro session', async () => {
    const onSync = vi.fn();
    await prepareKiroSend('k1', onSync);
    expect(onSync).not.toHaveBeenCalled();
    expect(service.checkSession).not.toHaveBeenCalled();
  });

  it('asks Kiro with the stored time and adds nothing when the session is unchanged', async () => {
    const id = await chat();
    service.checkSession.mockResolvedValue({ unchanged: true, updatedAt: AT });
    const onSync = vi.fn();
    await prepareKiroSend(id, onSync);
    expect(service.checkSession).toHaveBeenCalledWith(SESSION, 1, AT);
    expect(service.openSession).not.toHaveBeenCalled();
    expect(onSync).not.toHaveBeenCalled();
    expect(await contents(id)).toEqual(['one', 'one!']);
  });

  it('adds the new turns first when Kiro changed the session', async () => {
    const id = await chat();
    service.checkSession.mockResolvedValue(answer(['one', 'two'], 1));
    const onSync = vi.fn();
    await prepareKiroSend(id, onSync);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(await contents(id)).toEqual(['one', 'one!', 'two', 'two!']);
    expect((await db.conversations.get(id))?.kiro).toMatchObject({ turns: 2, updatedAt: LATER });
  });

  it('goes on when the check fails', async () => {
    const id = await chat();
    service.checkSession.mockRejectedValue(new Error('Kiro could not open this session.'));
    await expect(prepareKiroSend(id, vi.fn())).resolves.toBeUndefined();
    expect((await db.conversations.get(id))?.kiro).toMatchObject({ turns: 1, updatedAt: AT });
  });

  it('does not check a chat with no turn count, or with no time (D24)', async () => {
    for (const kiro of [{ updatedAt: AT }, { turns: 1 }]) {
      const id = await chat(kiro);
      await prepareKiroSend(id, vi.fn());
    }
    expect(service.checkSession).not.toHaveBeenCalled();
    expect(service.openSession).not.toHaveBeenCalled();
  });

  it('waits for a running sync, then checks', async () => {
    const id = await chat();
    const work = gate();
    void trackKiroSync(id, work.promise);
    service.checkSession.mockResolvedValue({ unchanged: true, updatedAt: AT });
    const onSync = vi.fn();
    const done = prepareKiroSend(id, onSync);
    expect(onSync).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(service.checkSession).not.toHaveBeenCalled();
    work.open();
    await done;
    expect(service.checkSession).toHaveBeenCalledTimes(1);
  });
});

describe('prepareKiroSend status while the check runs (K11 B5)', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('calls onSlow once when the check runs longer than the delay', async () => {
    const id = await chat();
    const slow = gate();
    service.checkSession.mockImplementation(async () => {
      await slow.promise;
      return { unchanged: true, updatedAt: AT };
    });
    const onSync = vi.fn();
    const onSlow = vi.fn();
    const done = prepareKiroSend(id, onSync, onSlow);
    await wait(KIRO_CHECK_STATUS_DELAY_MS - 150);
    expect(onSlow).not.toHaveBeenCalled();
    await wait(250);
    expect(onSlow).toHaveBeenCalledTimes(1);
    slow.open();
    await done;
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSync).not.toHaveBeenCalled();
  });

  it('does not call onSlow for a quick check, nor after the send says that it adds turns', async () => {
    const id = await chat();
    service.checkSession.mockResolvedValue({ unchanged: true, updatedAt: AT });
    const quick = vi.fn();
    await prepareKiroSend(id, vi.fn(), quick);
    await wait(KIRO_CHECK_STATUS_DELAY_MS + 50);
    expect(quick).not.toHaveBeenCalled();

    // A running sync: the send says "Adding the new Kiro turns…" at once, and keeps it
    const work = gate();
    void trackKiroSync(id, work.promise);
    const onSync = vi.fn();
    const afterSync = vi.fn();
    const done = prepareKiroSend(id, onSync, afterSync);
    await wait(KIRO_CHECK_STATUS_DELAY_MS + 50);
    work.open();
    await done;
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(afterSync).not.toHaveBeenCalled();
  });
});

describe('syncKiroChatOnOpen (K11)', () => {
  it('does nothing while a reply runs in the chat, and syncs after it (B5)', async () => {
    const id = await chat();
    service.checkSession.mockResolvedValue(answer(['one', 'two'], 1));
    const run = replyStore.start(id, []);
    await syncKiroChatOnOpen(id);
    expect(service.checkSession).not.toHaveBeenCalled();
    expect(service.openSession).not.toHaveBeenCalled();
    expect(await contents(id)).toEqual(['one', 'one!']);

    // The send's own check runs inside the reply and is not held back
    service.checkSession.mockResolvedValueOnce({ unchanged: true, updatedAt: AT });
    await prepareKiroSend(id, vi.fn());
    expect(service.checkSession).toHaveBeenCalledTimes(1);

    run.end('done');
    run.finish();
    await syncKiroChatOnOpen(id);
    expect(service.checkSession).toHaveBeenCalledTimes(2);
    expect(await contents(id)).toEqual(['one', 'one!', 'two', 'two!']);
  });

  it('counts the turns of a chat with no count and adds no message (D24)', async () => {
    const id = await chat({ updatedAt: AT });
    service.openSession.mockResolvedValue(answer(['one', 'two'], KIRO_COUNT_ONLY_SKIP));
    await syncKiroChatOnOpen(id);
    expect(service.openSession).toHaveBeenCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
    expect(service.checkSession).not.toHaveBeenCalled();
    expect(await contents(id)).toEqual(['one', 'one!']);
    expect((await db.conversations.get(id))?.kiro).toMatchObject({ turns: 2, updatedAt: LATER });
  });

  it('replays once for a chat with a count and no time', async () => {
    const id = await chat({ turns: 1 });
    service.openSession.mockResolvedValue(answer(['one', 'two'], 1));
    await syncKiroChatOnOpen(id);
    expect(service.openSession).toHaveBeenCalledWith(SESSION, 1);
    expect(await contents(id)).toEqual(['one', 'one!', 'two', 'two!']);
  });

  it('runs two syncs of one chat one after the other, so a turn is added once', async () => {
    const id = await chat();
    const first = gate();
    let calls = 0;
    service.checkSession.mockImplementation(async (_s: string, skip: number) => {
      calls += 1;
      if (calls === 1) await first.promise;
      return skip >= 2 ? { unchanged: true, updatedAt: LATER } : answer(['one', 'two'], skip);
    });
    const a = syncKiroChatOnOpen(id);
    const b = syncKiroChatOnOpen(id);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    first.open();
    await Promise.all([a, b]);
    // The second one asked with the new count and time
    expect(service.checkSession).toHaveBeenLastCalledWith(SESSION, 2, LATER);
    expect(await contents(id)).toEqual(['one', 'one!', 'two', 'two!']);
  });
});
