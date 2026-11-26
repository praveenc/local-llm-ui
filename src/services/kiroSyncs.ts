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
