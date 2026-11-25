// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createPermissionRegistry } from '../acp/permission-registry.ts';
import { answerPermission } from '../acp/permissions.ts';
import type { PermissionDecision, PermissionQuestion } from '../acp/permissions.ts';
import type { PermissionOption } from '../acp/types.ts';

const OPTIONS: PermissionOption[] = [
  { optionId: 'a', name: 'Allow', kind: 'allow_once' },
  { optionId: 'd', name: 'Deny', kind: 'reject_once' },
];

const ID = '11111111-2222-4333-8444-555555555555';

function question(controller = new AbortController(), requestId = ID): PermissionQuestion {
  return { requestId, toolCallId: 't1', options: OPTIONS, signal: controller.signal };
}

describe('createPermissionRegistry', () => {
  it('answers once with an option that the question lists, then forgets it', async () => {
    const registry = createPermissionRegistry();
    const asked = registry.ask(question());
    expect(registry.size).toBe(1);
    expect(registry.answer(ID, 'nope')).toBe('invalid-option');
    // A wrong option keeps the question open
    expect(registry.size).toBe(1);
    expect(registry.answer(ID, 'd')).toBe('answered');
    expect(await asked).toEqual({ optionId: 'd' });
    expect(registry.size).toBe(0);
    expect(registry.answer(ID, 'a')).toBe('unknown');
  });

  it('says unknown for an id that it never asked', () => {
    expect(createPermissionRegistry().answer(ID, 'a')).toBe('unknown');
  });

  it('cancels and forgets a question when its signal aborts', async () => {
    const registry = createPermissionRegistry();
    const controller = new AbortController();
    const asked = registry.ask(question(controller));
    controller.abort();
    expect(await asked).toBe('cancelled');
    expect(registry.size).toBe(0);
    expect(registry.answer(ID, 'a')).toBe('unknown');
  });

  it('cancels at once for an aborted signal or an id that is already open', async () => {
    const registry = createPermissionRegistry();
    const controller = new AbortController();
    controller.abort();
    expect(await registry.ask(question(controller))).toBe('cancelled');
    expect(registry.size).toBe(0);
    const first = registry.ask(question());
    expect(await registry.ask(question())).toBe('cancelled');
    expect(registry.answer(ID, 'a')).toBe('answered');
    expect(await first).toEqual({ optionId: 'a' });
  });

  it('keeps two questions apart', async () => {
    const registry = createPermissionRegistry();
    const other = '66666666-7777-4888-9999-000000000000';
    const one = registry.ask(question());
    const two = registry.ask(question(new AbortController(), other));
    expect(registry.answer(other, 'a')).toBe('answered');
    expect(registry.answer(ID, 'd')).toBe('answered');
    expect(await Promise.all([one, two])).toEqual([{ optionId: 'd' }, { optionId: 'a' }]);
  });
});

describe('answerPermission ends', () => {
  const run = (
    ask: () => Promise<PermissionDecision>,
    input: { signal?: AbortSignal; cancelled?: boolean; timeoutMs?: number } = {}
  ) =>
    answerPermission({
      options: OPTIONS,
      signal: input.signal ?? new AbortController().signal,
      timeoutMs: input.timeoutMs ?? 1000,
      cancelled: () => input.cancelled ?? false,
      ask,
    });

  it('answered: the option that the handler chose', async () => {
    expect(await run(async () => ({ optionId: 'a' }))).toEqual({
      outcome: { outcome: { outcome: 'selected', optionId: 'a' } },
      end: 'answered',
    });
  });

  it('timeout: no answer in time, a failed handler, or an option that is not listed', async () => {
    const reject = {
      outcome: { outcome: { outcome: 'selected', optionId: 'd' } },
      end: 'timeout',
    };
    expect(await run(() => new Promise(() => undefined), { timeoutMs: 20 })).toEqual(reject);
    expect(await run(() => Promise.reject(new Error('x')))).toEqual(reject);
    expect(await run(async () => ({ optionId: 'nope' }))).toEqual(reject);
  });

  it('cancelled: the signal aborts, the prompt was cancelled, or the handler cancelled', async () => {
    const cancelled = { outcome: { outcome: { outcome: 'cancelled' } }, end: 'cancelled' };
    const controller = new AbortController();
    const pending = run(() => new Promise(() => undefined), { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual(cancelled);
    expect(await run(async () => ({ optionId: 'a' }), { cancelled: true })).toEqual(cancelled);
    expect(await run(async () => 'cancelled')).toEqual(cancelled);
  });
});
