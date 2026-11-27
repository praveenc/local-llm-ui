/**
 * The running syncs of imported Kiro chats (K7), by conversation id, and the sync itself (K11).
 * Opening a chat adds the turns that Kiro made in the terminal in the background. A send into
 * that chat waits for the sync first, so it reads the new turns and the new turn count, and does
 * not write the old count back over them. Before a send, the chat also asks Kiro once whether the
 * session changed since the chat's last sync (the exact check), and adds the new turns first.
 */
import { db } from '../db';
import { KIRO_COUNT_ONLY_SKIP } from '../utils/kiroSessions';
import { replyStore } from '../utils/replyStore';
import { kiroService } from './kiro';
import { appendKiroTurns, backfillKiroTurns } from './kiroImport';

const running = new Map<string, Promise<void>>();

/**
 * Keeps `work` as a running sync of the conversation until it ends, together with a sync that
 * runs already (a second open of the chat). It never rejects.
 */
export function trackKiroSync(conversationId: string, work: Promise<unknown>): Promise<void> {
  const before = running.get(conversationId);
  const done = Promise.all([before, work]).then(
    () => undefined,
    () => undefined
  );
  running.set(conversationId, done);
  void done.then(() => {
    if (running.get(conversationId) === done) running.delete(conversationId);
  });
  return done;
}

/** The running sync of the conversation, or undefined when none runs */
export function runningKiroSync(conversationId: string): Promise<void> | undefined {
  return running.get(conversationId);
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'unknown error';

/**
 * Adds the turns that Kiro made after the chat's last sync (K7, K11). A chat that counts turns
 * and has Kiro's time asks with that time: when Kiro's time is still the same, nothing is
 * replayed. Else `onSync` is called and the new turns are added in Kiro's order.
 *
 * `count`: a chat with no turn count (D24) gets one: one count-only open that adds no message, so
 * turns that the terminal made before it are not imported. Without `count` such a chat is left
 * as it is (a send: the next open counts). Never rejects: the chat keeps its messages.
 */
export async function syncKiroChat(
  conversationId: string,
  { count = false, onSync }: { count?: boolean; onSync?: () => void } = {}
): Promise<void> {
  try {
    const kiro = (await db.conversations.get(conversationId))?.kiro;
    if (!kiro) return;
    if (kiro.turns === undefined) {
      if (!count) return;
      const session = await kiroService.openSession(kiro.sessionId, KIRO_COUNT_ONLY_SKIP);
      await backfillKiroTurns(conversationId, kiro.sessionId, session);
      return;
    }
    if (!kiro.updatedAt) {
      // No time to compare with (an older chat): the next open replays once and stores it
      if (!count) return;
      onSync?.();
      await appendKiroTurns(
        conversationId,
        await kiroService.openSession(kiro.sessionId, kiro.turns),
        kiro.turns
      );
      return;
    }
    const session = await kiroService.checkSession(kiro.sessionId, kiro.turns, kiro.updatedAt);
    if ('unchanged' in session) return;
    onSync?.();
    await appendKiroTurns(conversationId, session, kiro.turns);
  } catch (error) {
    // The next open tries again; a send goes on, and the chat route's time decides its count
    console.error('Failed to add the new Kiro turns:', errorText(error));
  }
}

/**
 * Runs `work` after the running sync of the conversation, and keeps it as the running sync. Two
 * syncs of one chat then never replay at the same time.
 */
function queueKiroSync(conversationId: string, work: () => Promise<void>): Promise<void> {
  const before = running.get(conversationId) ?? Promise.resolve();
  return trackKiroSync(conversationId, before.then(work));
}

/**
 * The sync of an opened chat (K7, K11): counts the turns of a chat that has no count (D24). It
 * does nothing while a reply runs in the chat: Kiro already has that reply's turn, but the chat
 * stores its count only when the reply ends, so a replay now would add the app's own turn again.
 * The check runs when the sync starts, after a sync before it. A send's check runs inside its
 * reply, through `prepareKiroSend`, and is not held back.
 */
export function syncKiroChatOnOpen(conversationId: string): Promise<void> {
  return queueKiroSync(conversationId, async () => {
    if (replyStore.isRunning(conversationId)) return;
    await syncKiroChat(conversationId, { count: true });
  });
}

/** How long the check before a send runs before the chat says so (K11) */
export const KIRO_CHECK_STATUS_DELAY_MS = 300;

/**
 * Before a send into a Kiro chat (K7, K11): waits for a running sync of the chat, then asks Kiro
 * once whether the session changed since the chat's last sync, and adds the new turns first.
 * `onSync` is called when the send has to wait for turns, so that it says so. `onSlow` is called
 * once when all this takes longer than KIRO_CHECK_STATUS_DELAY_MS and `onSync` was not called
 * (the check can start Kiro CLI, a few seconds). Never rejects: a failed check only means that
 * the reply may store no turn count (the chat route decides).
 */
export async function prepareKiroSend(
  conversationId: string,
  onSync: () => void,
  onSlow?: () => void
): Promise<void> {
  let synced = false;
  const sync = () => {
    synced = true;
    onSync();
  };
  if (running.has(conversationId)) sync();
  const timer = onSlow
    ? setTimeout(() => {
        if (!synced) onSlow();
      }, KIRO_CHECK_STATUS_DELAY_MS)
    : undefined;
  try {
    await queueKiroSync(conversationId, () => syncKiroChat(conversationId, { onSync: sync }));
  } finally {
    clearTimeout(timer);
  }
}
