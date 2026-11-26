/**
 * The running syncs of imported Kiro chats (K7), by conversation id. Opening a chat adds the
 * turns that Kiro made in the terminal in the background. A send into that chat waits for the
 * sync first, so it reads the new turns and the new turn count, and does not write the old
 * count back over them.
 */
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

/**
 * Runs before a send into a Kiro chat (K11). The sessions hook sets it while the sessions section
 * is on: when a list that the browser holds already shows that Kiro has turns that the chat does
 * not have, it adds them first and calls `onSync`, so that the send says that it waits. It does
 * not decide the turn count: the server's time of the session does (`isKiroChatInSync`).
 */
export type KiroSendCheck = (conversationId: string, onSync: () => void) => Promise<void>;

let sendCheck: KiroSendCheck | undefined;

/** Sets the check; the returned function removes it again */
export function setKiroSendCheck(check: KiroSendCheck): () => void {
  sendCheck = check;
  return () => {
    if (sendCheck === check) sendCheck = undefined;
  };
}

/**
 * Before a send into a Kiro chat (K7, K11): waits for a running sync of the chat, then runs the
 * check, which may add the turns that a cached list shows first. Never rejects: a failed check
 * only means that the reply may store no turn count.
 */
export async function prepareKiroSend(conversationId: string, onSync: () => void): Promise<void> {
  const sync = running.get(conversationId);
  if (sync) {
    onSync();
    await sync;
  }
  try {
    await sendCheck?.(conversationId, onSync);
  } catch {
    // The next open adds or counts the turns
  }
}
