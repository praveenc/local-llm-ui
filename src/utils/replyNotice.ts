/**
 * Which reply events show a toast, and its text. The browser module `services/replyNotices.ts`
 * decides whether the chat is on screen, adds the chat title and (off screen) the Open action,
 * and shows it.
 *
 * Keep this file free of DOM and Node imports.
 */

/** Something that happened to a reply */
export type ReplyEvent = 'done' | 'failed' | 'stopped' | 'waiting';

/** When an event shows a toast */
export type NoticeRule = 'always' | 'off-screen' | 'never';

/**
 * The one place for the toast rules. A chat is on screen when it is the open chat and the
 * browser tab shows. 'always' shows a toast on screen too, 'off-screen' only when the chat is
 * not on screen.
 */
export const REPLY_NOTICE_RULES: Readonly<Record<ReplyEvent, NoticeRule>> = {
  done: 'always',
  failed: 'always',
  // You stopped it yourself
  stopped: 'never',
  // In the open chat the work row already opens by itself with Kiro's buttons
  waiting: 'off-screen',
};

export interface ReplyNotice {
  kind: 'success' | 'error' | 'info';
  title: string;
  /** One toast per chat: a later event of the same chat replaces it */
  toastId: string;
}

const TITLES: Record<ReplyEvent, string> = {
  done: 'Reply ready',
  failed: 'Reply failed',
  stopped: 'Reply stopped',
  waiting: 'Kiro is waiting for your answer',
};

const KINDS: Record<ReplyEvent, ReplyNotice['kind']> = {
  done: 'success',
  failed: 'error',
  stopped: 'info',
  waiting: 'info',
};

/** The toast for an event, or null when the rules say none */
export function replyNotice(
  event: ReplyEvent,
  conversationId: string,
  onScreen: boolean,
  rules: Readonly<Record<ReplyEvent, NoticeRule>> = REPLY_NOTICE_RULES
): ReplyNotice | null {
  const rule = rules[event];
  if (rule === 'never' || (rule === 'off-screen' && onScreen)) return null;
  return { kind: KINDS[event], title: TITLES[event], toastId: replyToastId(conversationId) };
}

/** The toast id of a chat */
export function replyToastId(conversationId: string): string {
  return `reply-${conversationId}`;
}
