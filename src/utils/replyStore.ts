/**
 * The running replies, one per chat, keyed by conversation id.
 *
 * A reply belongs to the chat that sent it. The chat view only reads the reply of the open chat,
 * so New chat, or a click on another chat, does not stop a reply or show it in the other chat.
 * The store lives at module level and holds no React or DOM code; `useReply` and
 * `useReplyActivity` read it with `useSyncExternalStore`.
 *
 * Life of an entry:
 * - `start` makes the entry (status `submitted`) and returns a `ReplyRun` handle. The stream loop
 *   writes only through that handle, so a write always goes to the reply's own chat.
 * - `end` marks the entry ended (`idle` or `error`). A reply that ends well in a chat that is not
 *   on screen is removed at once: the chat reads the saved reply from the database when it opens.
 *   Other ended entries stay (the text before a stop, the error), so the chat still shows them.
 * - `dismiss` removes an ended entry when the user leaves its chat.
 *
 * Keep this file free of DOM and Node imports.
 */
import type { UIMessage } from '../types/ai-messages';

/** The same values as the hook's ChatStatus: `submitted` and `streaming` run, the others ended */
export type ReplyStatus = 'submitted' | 'streaming' | 'idle' | 'error';

/** How a reply ended */
export type ReplyOutcome = 'done' | 'failed' | 'stopped';

/** What the sidebar says about a chat with a running reply */
export type ReplyActivity = 'replying' | 'waiting';

/** One chat's reply, as the chat view shows it */
export interface ReplyState {
  conversationId: string;
  status: ReplyStatus;
  /** The whole chat as the reply sees it: the earlier messages, the user message, the reply */
  messages: UIMessage[];
  /** Progress before the first output, for example "Starting Kiro…". Not stored. */
  streamStatus: string | null;
  error: string | null;
  /** The user stopped the reply */
  wasInterrupted: boolean;
  /** Kiro asks a question about a tool that has no answer yet */
  waiting: boolean;
}

/** The handle of one running reply. Writes after a newer run of the same chat do nothing. */
export interface ReplyRun {
  readonly conversationId: string;
  /** Aborted by `stop` (or `clear`) */
  readonly signal: AbortSignal;
  /** True while this run owns the entry and has not ended */
  isActive(): boolean;
  /**
   * Changes the reply's messages while it runs, and after a stop until `finish`: the run then
   * keeps the text received before the stop and ends its open questions
   */
  setMessages(change: (messages: UIMessage[]) => UIMessage[]): void;
  update(patch: Partial<Pick<ReplyState, 'status' | 'streamStatus' | 'waiting'>>): void;
  /** Ends the reply. The first call counts; a stop has already ended it as `stopped`. */
  end(outcome: ReplyOutcome, error?: string): void;
  /** Call in `finally`, after the last database write: `stop` waits for it */
  finish(): void;
}

export interface ReplyStore {
  start(conversationId: string, messages: UIMessage[]): ReplyRun;
  get(conversationId: string | null): ReplyState | undefined;
  /** True while the chat's reply is `submitted` or `streaming` */
  isRunning(conversationId: string | null): boolean;
  /**
   * Stops the chat's running reply: aborts its request, keeps its text, and marks it stopped.
   * Resolves when the run has finished its last write (at once when nothing runs).
   */
  stop(conversationId: string): Promise<void>;
  /** Shows an error in a chat without a run, for example a failed fork */
  fail(conversationId: string, messages: UIMessage[], error: string): void;
  /** Changes the messages of an entry that exists, for example a rating on a shown reply */
  editMessages(conversationId: string, change: (messages: UIMessage[]) => UIMessage[]): void;
  /** Removes the entry if its reply has ended */
  dismiss(conversationId: string): void;
  /** Removes the entry (after a delete). Stop it first. */
  remove(conversationId: string): void;
  /** The chat that the view shows now, or null for a new chat */
  setOnScreen(conversationId: string | null): void;
  onScreen(): string | null;
  /** Running chats only. The same object until a status or a question changes. */
  activity(): ReadonlyMap<string, ReplyActivity>;
  subscribe(listener: () => void): () => void;
  /** Aborts every run and removes every entry (tests) */
  clear(): void;
}

export function isRunningStatus(status: ReplyStatus | undefined): boolean {
  return status === 'submitted' || status === 'streaming';
}

interface Entry {
  state: ReplyState;
  run: number;
  controller: AbortController | null;
  finished: Promise<void>;
  resolveFinished: () => void;
  /** The run has called `finish` */
  done: boolean;
}

const NO_ACTIVITY: ReadonlyMap<string, ReplyActivity> = new Map();

export function createReplyStore(): ReplyStore {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let nextRun = 1;
  let onScreenId: string | null = null;
  let activitySnapshot: ReadonlyMap<string, ReplyActivity> = NO_ACTIVITY;

  const activityOf = (state: ReplyState): ReplyActivity | undefined =>
    isRunningStatus(state.status) ? (state.waiting ? 'waiting' : 'replying') : undefined;

  const rebuildActivity = () => {
    const next = new Map<string, ReplyActivity>();
    for (const [id, entry] of entries) {
      const activity = activityOf(entry.state);
      if (activity) next.set(id, activity);
    }
    const same =
      next.size === activitySnapshot.size &&
      [...next].every(([id, activity]) => activitySnapshot.get(id) === activity);
    if (!same) activitySnapshot = next.size === 0 ? NO_ACTIVITY : next;
  };

  const emit = () => {
    rebuildActivity();
    for (const listener of [...listeners]) listener();
  };

  const setState = (id: string, change: (state: ReplyState) => ReplyState) => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.state = change(entry.state);
    emit();
  };

  const makeEntry = (state: ReplyState, controller: AbortController | null): Entry => {
    let resolveFinished = () => {};
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    if (!controller) resolveFinished();
    return { state, run: nextRun++, controller, finished, resolveFinished, done: !controller };
  };

  const endEntry = (id: string, entry: Entry, outcome: ReplyOutcome, error?: string) => {
    entry.controller = null;
    if (outcome === 'done' && onScreenId !== id) {
      entries.delete(id);
      emit();
      return;
    }
    entry.state = {
      ...entry.state,
      status: outcome === 'failed' ? 'error' : 'idle',
      streamStatus: null,
      waiting: false,
      error: outcome === 'failed' ? (error ?? 'Failed to send message') : null,
      wasInterrupted: outcome === 'stopped',
    };
    emit();
  };

  return {
    start(conversationId, messages) {
      // A run that is still finishing (after a stop) keeps its promise for `stop` callers
      const controller = new AbortController();
      const entry = makeEntry(
        {
          conversationId,
          status: 'submitted',
          messages,
          streamStatus: null,
          error: null,
          wasInterrupted: false,
          waiting: false,
        },
        controller
      );
      entries.set(conversationId, entry);
      emit();
      const run = entry.run;
      const own = () => {
        const current = entries.get(conversationId);
        return current && current.run === run ? current : undefined;
      };
      const active = () => {
        const current = own();
        return current && isRunningStatus(current.state.status) ? current : undefined;
      };
      return {
        conversationId,
        signal: controller.signal,
        isActive: () => active() !== undefined,
        setMessages(change) {
          const current = own();
          const stoppedNotFinished = current && current.state.wasInterrupted && !current.done;
          if (active() || stoppedNotFinished) {
            setState(conversationId, (s) => ({ ...s, messages: change(s.messages) }));
          }
        },
        update(patch) {
          if (active()) setState(conversationId, (s) => ({ ...s, ...patch }));
        },
        end(outcome, error) {
          const current = active();
          if (current) endEntry(conversationId, current, outcome, error);
        },
        finish() {
          entry.done = true;
          entry.controller = null;
          entry.resolveFinished();
        },
      };
    },

    get: (conversationId) => (conversationId ? entries.get(conversationId)?.state : undefined),

    isRunning: (conversationId) =>
      conversationId ? isRunningStatus(entries.get(conversationId)?.state.status) : false,

    stop(conversationId) {
      const entry = entries.get(conversationId);
      if (!entry) return Promise.resolve();
      if (isRunningStatus(entry.state.status)) {
        const controller = entry.controller;
        endEntry(conversationId, entry, 'stopped');
        controller?.abort();
      }
      return entry.finished;
    },

    fail(conversationId, messages, error) {
      if (isRunningStatus(entries.get(conversationId)?.state.status)) return;
      entries.set(
        conversationId,
        makeEntry(
          {
            conversationId,
            status: 'error',
            messages,
            streamStatus: null,
            error,
            wasInterrupted: false,
            waiting: false,
          },
          null
        )
      );
      emit();
    },

    editMessages(conversationId, change) {
      setState(conversationId, (s) => ({ ...s, messages: change(s.messages) }));
    },

    dismiss(conversationId) {
      const entry = entries.get(conversationId);
      if (!entry || isRunningStatus(entry.state.status)) return;
      entries.delete(conversationId);
      emit();
    },

    remove(conversationId) {
      if (!entries.delete(conversationId)) return;
      emit();
    },

    setOnScreen(conversationId) {
      onScreenId = conversationId;
    },

    onScreen: () => onScreenId,

    activity: () => activitySnapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear() {
      for (const entry of entries.values()) {
        entry.controller?.abort();
        entry.resolveFinished();
      }
      entries.clear();
      onScreenId = null;
      emit();
    },
  };
}

/** The app's one store */
export const replyStore: ReplyStore = createReplyStore();
