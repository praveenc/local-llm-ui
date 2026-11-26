/**
 * The toast when a reply ends or fails, and when Kiro waits for an answer in a chat that is not
 * on screen. A chat that is on screen gets no Open action: the chat is already open.
 * The rules are in src/utils/replyNotice.ts (REPLY_NOTICE_RULES).
 */
import { toast } from 'sonner';

import { type ReplyEvent, replyNotice } from '../utils/replyNotice';
import { replyStore } from '../utils/replyStore';
import { conversationService } from './conversationService';

type Opener = (conversationId: string) => void;

// The Sidebar's openers (the same path as a click on a row, with the K7 sync). The desktop
// sidebar and the navigation sheet can both be mounted; the last one mounted wins.
const openers: Opener[] = [];
// The app's opener, for when no sidebar is mounted (collapsed sidebar, closed sheet)
let fallbackOpener: Opener | null = null;

/** Adds a sidebar opener for the Open action. Returns the function that removes it. */
export function setReplyOpener(next: Opener): () => void {
  openers.push(next);
  return () => {
    const index = openers.lastIndexOf(next);
    if (index >= 0) openers.splice(index, 1);
  };
}

/** Sets the opener for when no sidebar is mounted */
export function setFallbackReplyOpener(next: Opener | null): void {
  fallbackOpener = next;
}

function openChat(conversationId: string): void {
  const opener = openers.at(-1) ?? fallbackOpener;
  opener?.(conversationId);
}

/** A chat is on screen when it is the open chat and the browser tab shows */
function isOnScreen(conversationId: string): boolean {
  return (
    replyStore.onScreen() === conversationId &&
    (typeof document === 'undefined' || document.visibilityState === 'visible')
  );
}

/** Shows the toast of a reply event when the rules ask for one. Never throws. */
export async function notifyReply(conversationId: string, event: ReplyEvent): Promise<void> {
  const onScreen = isOnScreen(conversationId);
  const notice = replyNotice(event, conversationId, onScreen);
  if (!notice) return;
  try {
    const conversation = await conversationService.get(conversationId).catch(() => undefined);
    const description = conversation?.title || 'New conversation';
    toast[notice.kind](notice.title, {
      // One toast per chat: a later event replaces the earlier one
      id: notice.toastId,
      description,
      // On screen the chat is already open, so there is nothing to open
      action: onScreen ? undefined : { label: 'Open', onClick: () => openChat(conversationId) },
    });
  } catch (err) {
    // No titles in the log
    console.error('Failed to show the reply toast:', err instanceof Error ? err.name : 'Error');
  }
}
