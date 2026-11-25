/**
 * Kiro's permission questions in a chat (K6, D16): the `permission` and `permissionResult` SSE
 * events. Kiro owns the questions, their options and labels, and its "always" rules. This file
 * only reads Kiro's own values from the request's `_meta.kiro`.
 *
 * A file write asks twice: the write, then "Review changes" (`_meta.kiro.type: 'turn_approval'`).
 * The review has a made-up tool call id; `_meta.kiro.files[].toolCallId` names the writes.
 */
import type {
  KiroPermissionQuestion,
  KiroPermissionResult,
} from '../../src/utils/kiroPermissions.ts';
import type { PermissionEnd, PermissionQuestion } from '../acp/permissions.ts';

const MAX_TEXT = 2000;
const MAX_ID = 200;
const MAX_OPTIONS = 10;
const MAX_RELATED = 50;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value.slice(0, MAX_TEXT) : undefined;

const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value && value.length <= MAX_ID ? value : undefined;

/** The `permission` event for one question */
export function kiroQuestion(question: PermissionQuestion): KiroPermissionQuestion {
  const kiro = asRecord(asRecord(question.meta)?.kiro);
  const review = kiro?.type === 'turn_approval';
  const related = (Array.isArray(kiro?.files) ? kiro.files : [])
    .map((file) => id(asRecord(file)?.toolCallId))
    .filter((value): value is string => value !== undefined)
    .slice(0, MAX_RELATED);
  const command = text(kiro?.command);
  const resource = text(asRecord(kiro?.consent)?.resource);
  return {
    requestId: question.requestId,
    toolCallId: question.toolCallId,
    title: text(question.title) ?? '',
    options: question.options.slice(0, MAX_OPTIONS).map((o) => ({
      optionId: o.optionId,
      name: text(o.name) ?? o.optionId,
      kind: o.kind,
    })),
    ...(related.length > 0 && { relatedToolCallIds: [...new Set(related)] }),
    ...(review && { review: true }),
    ...(command && { command }),
    ...(resource && { resource }),
  };
}

/** The `permissionResult` event when a question ended */
export function kiroPermissionResult(end: PermissionEnd): KiroPermissionResult {
  return {
    requestId: end.requestId,
    ...(end.optionId !== undefined && { optionId: end.optionId }),
    ...(end.kind !== undefined && { kind: end.kind }),
    outcome: end.end,
  };
}
