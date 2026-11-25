/**
 * The answers to Kiro's permission requests in a chat (D7, SEC-16): every tool is denied with
 * its reject_once option until the approvals of K6. K6 rewrites this file.
 */
import { optionIdForKind } from '../acp/permissions.ts';
import type { PromptPermissionHandler } from '../acp/permissions.ts';

/** Denies every request of one prompt. `onDenied` gets the tool call id first. */
export function denyAllApprovals(
  sessionId: string,
  onDenied: (toolCallId: string) => void
): PromptPermissionHandler {
  return (question) => {
    onDenied(question.toolCallId);
    const optionId = optionIdForKind(
      {
        sessionId,
        toolCall: { toolCallId: question.toolCallId },
        options: question.options,
      },
      'reject_once'
    );
    return optionId ? { optionId } : 'cancelled';
  };
}
