/**
 * Kiro's questions (K6) on the tool calls of a streaming reply. `useBedrockChat` keeps the tool
 * calls in a map, puts each `permission` event on its tool call, and ends it on its
 * `permissionResult`. These helpers pick the tool call and end the questions that stay open
 * when the reply ends.
 */
import type { MessagePart } from '../types/ai-messages';
import {
  type KiroPermissionQuestion,
  type ToolApproval,
  endApproval,
} from '../utils/kiroPermissions';

/** A tool call of the reply that streams now */
export interface StreamToolCall {
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'complete' | 'error';
  result?: unknown;
  approvals?: ToolApproval[];
}

/** The line of a question that has no title */
const QUESTION_TOOL_NAME = 'Kiro question';

/**
 * The tool call that shows a question: "Review changes" goes on the write that it reviews,
 * else the question's own tool call (a new line when it has not come)
 */
export function questionTarget(question: KiroPermissionQuestion, knownIds: string[]): string {
  return question.relatedToolCallIds?.find((id) => knownIds.includes(id)) ?? question.toolCallId;
}

/** The line of a question whose tool call is not known */
export function questionToolCall(question: KiroPermissionQuestion): StreamToolCall {
  return { toolName: question.title || QUESTION_TOOL_NAME, args: {}, status: 'pending' };
}

const endOpen = (approvals: ToolApproval[]) =>
  approvals.map((a) =>
    a.state === 'open' ? endApproval(a, { requestId: a.requestId, outcome: 'cancelled' }) : a
  );

/** The tool call with its open questions ended as not answered */
export function withQuestionEnded<T extends { approvals?: ToolApproval[] }>(entry: T): T {
  return entry.approvals ? { ...entry, approvals: endOpen(entry.approvals) } : entry;
}

/** The parts with every open question ended as not answered (Stop or an error) */
export function withQuestionsEnded(parts: MessagePart[]): MessagePart[] {
  return parts.map((part) => (part.type === 'tool-call' ? withQuestionEnded(part) : part));
}
