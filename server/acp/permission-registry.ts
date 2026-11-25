/**
 * The open permission questions of all prompts, for answers that come in a separate request.
 *
 * `ask` keeps a question under its server-made `requestId` until it is answered or its signal
 * aborts (the prompt ended, was cancelled, or the agent's timeout answered for it). `answer`
 * accepts only an option that the question itself lists, answers once, and then forgets the
 * question. The registry has no timer of its own: the agent ends every question.
 */
import type { PermissionDecision, PromptPermissionHandler } from './permissions.ts';
import type { PermissionOption } from './types.ts';

export type PermissionAnswerResult = 'answered' | 'unknown' | 'invalid-option';

export interface PermissionRegistry {
  /** The prompt's permission handler: waits for `answer`, or `cancelled` when the signal aborts */
  ask: PromptPermissionHandler;
  /** `unknown`: no open question has this id (never asked, answered, or ended) */
  answer(requestId: string, optionId: string): PermissionAnswerResult;
  /** The number of open questions */
  readonly size: number;
}

interface Entry {
  options: PermissionOption[];
  resolve(decision: PermissionDecision): void;
}

export function createPermissionRegistry(): PermissionRegistry {
  const open = new Map<string, Entry>();

  const ask: PromptPermissionHandler = (question) => {
    const { requestId, signal } = question;
    if (signal.aborted || open.has(requestId)) return 'cancelled';
    return new Promise<PermissionDecision>((resolve) => {
      const onAbort = () => {
        if (open.get(requestId) !== entry) return;
        open.delete(requestId);
        resolve('cancelled');
      };
      const entry: Entry = {
        options: question.options,
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      };
      open.set(requestId, entry);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  return {
    ask,
    answer(requestId, optionId) {
      const entry = open.get(requestId);
      if (!entry) return 'unknown';
      if (!entry.options.some((o) => o.optionId === optionId)) return 'invalid-option';
      open.delete(requestId);
      entry.resolve({ optionId });
      return 'answered';
    },
    get size() {
      return open.size;
    },
  };
}
