/**
 * Kiro tool approvals (K6, D16): the SSE events of a Kiro question, the body of
 * POST /api/kiro/permission, and the approval that the work row shows and stores with a tool call.
 * Shared by the browser and the server, so no DOM or Node imports.
 *
 * Kiro owns the questions, their options and labels, and its "always" rules. The app shows the
 * question, sends the option that the user clicks, and says the answer in words from its kind.
 */

/** The option kinds of ACP. Kiro can send others: the app then shows the name only. */
export type KiroPermissionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface KiroPermissionOption {
  optionId: string;
  /** Kiro's label, for example "Allow" or "Accept changes" */
  name: string;
  kind: string;
}

/** SSE `{ permission }`: Kiro asks a question. Kiro asks one at a time in a session. */
export interface KiroPermissionQuestion {
  /** Made by the server for this question; the answer names it */
  requestId: string;
  /** Kiro's tool call id. For "Review changes" a made-up id that has no tool call. */
  toolCallId: string;
  /** Kiro's title: the command for a shell tool, "Write File", or "Review changes" */
  title: string;
  /** Kiro's options in Kiro's order */
  options: KiroPermissionOption[];
  /** "Review changes": the tool calls of the writes that it reviews (`_meta.kiro.files`) */
  relatedToolCallIds?: string[];
  /** True for "Review changes" (`_meta.kiro.type: 'turn_approval'`) */
  review?: boolean;
  /** The shell command (`_meta.kiro.command`) */
  command?: string;
  /** The path or other resource of the question (`_meta.kiro.consent.resource`) */
  resource?: string;
}

/**
 * How a question ended. `answered`: the user clicked an option. `cancelled`: Stop, a closed
 * stream, or a crash. `timeout`: no answer in 10 minutes (the server sent the reject_once option).
 */
export type KiroPermissionOutcome = 'answered' | 'cancelled' | 'timeout';

/** SSE `{ permissionResult }`: a question ended. Sent for every question that was sent. */
export interface KiroPermissionResult {
  requestId: string;
  /** The option that Kiro got, when it got one */
  optionId?: string;
  kind?: string;
  outcome: KiroPermissionOutcome;
}

export type KiroPermissionEvent =
  { permission: KiroPermissionQuestion } | { permissionResult: KiroPermissionResult };

/** The body of POST /api/kiro/permission */
export interface KiroPermissionAnswer {
  requestId: string;
  optionId: string;
}

/** The body limit of POST /api/kiro/permission */
export const KIRO_PERMISSION_BODY_LIMIT = 1024;

/**
 * One question on a tool call part. Open while the reply runs; it is never stored open.
 * The stored form (`toStoredApproval`) keeps only `state`, `kind`, `review`, and `requestId`.
 */
export interface ToolApproval {
  requestId: string;
  state: 'open' | 'answered' | 'not-answered';
  /** The kind of the option that Kiro got */
  kind?: string;
  review?: boolean;
  /** Open questions only */
  title?: string;
  command?: string;
  resource?: string;
  options?: KiroPermissionOption[];
}

export type StoredToolApproval = Pick<ToolApproval, 'requestId' | 'state' | 'kind' | 'review'>;

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ID = 200;
const MAX_TEXT = 2000;
const MAX_OPTIONS = 10;
const MAX_RELATED = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const shortString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const cutText = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value.slice(0, MAX_TEXT) : undefined;

export function isRejectKind(kind: string | undefined): boolean {
  return kind === 'reject_once' || kind === 'reject_always';
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Checks the body of POST /api/kiro/permission */
export function parseKiroPermissionAnswer(value: unknown): Parsed<KiroPermissionAnswer> {
  if (!isRecord(value)) return { ok: false, error: 'Send the answer as a JSON object' };
  const { requestId, optionId } = value;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return { ok: false, error: 'The request id is not valid' };
  }
  if (!shortString(optionId, MAX_ID)) return { ok: false, error: 'The option id is not valid' };
  return { ok: true, value: { requestId, optionId } };
}

const parseOption = (value: unknown): KiroPermissionOption | undefined => {
  if (!isRecord(value)) return undefined;
  const { optionId, name, kind } = value;
  if (!shortString(optionId, MAX_ID) || !shortString(kind, MAX_ID)) return undefined;
  return { optionId, name: cutText(name) ?? optionId, kind };
};

/** The `permission` SSE event, or undefined when it is not valid */
export function parseKiroPermissionQuestion(value: unknown): KiroPermissionQuestion | undefined {
  if (!isRecord(value)) return undefined;
  const { requestId, toolCallId, relatedToolCallIds } = value;
  if (!shortString(requestId, MAX_ID) || !shortString(toolCallId, MAX_ID)) return undefined;
  if (!Array.isArray(value.options)) return undefined;
  const options = value.options
    .slice(0, MAX_OPTIONS)
    .map(parseOption)
    .filter((o): o is KiroPermissionOption => o !== undefined);
  if (options.length === 0) return undefined;
  const related = Array.isArray(relatedToolCallIds)
    ? relatedToolCallIds.slice(0, MAX_RELATED).filter((id): id is string => shortString(id, MAX_ID))
    : [];
  const command = cutText(value.command);
  const resource = cutText(value.resource);
  return {
    requestId,
    toolCallId,
    title: cutText(value.title) ?? '',
    options,
    ...(related.length > 0 && { relatedToolCallIds: related }),
    ...(value.review === true && { review: true }),
    ...(command && { command }),
    ...(resource && { resource }),
  };
}

const OUTCOMES: readonly string[] = ['answered', 'cancelled', 'timeout'];

/** The `permissionResult` SSE event, or undefined when it is not valid */
export function parseKiroPermissionResult(value: unknown): KiroPermissionResult | undefined {
  if (!isRecord(value)) return undefined;
  const { requestId, optionId, kind, outcome } = value;
  if (!shortString(requestId, MAX_ID)) return undefined;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) return undefined;
  return {
    requestId,
    ...(shortString(optionId, MAX_ID) && { optionId }),
    ...(shortString(kind, MAX_ID) && { kind }),
    outcome: outcome as KiroPermissionOutcome,
  };
}

/** The open approval for a question */
export function openApproval(question: KiroPermissionQuestion): ToolApproval {
  return {
    requestId: question.requestId,
    state: 'open',
    title: question.title,
    options: question.options,
    ...(question.review && { review: true }),
    ...(question.command && { command: question.command }),
    ...(question.resource && { resource: question.resource }),
  };
}

/**
 * The approval after its question ended. Only a user's answer counts as `answered`: a timeout
 * sent Kiro the reject_once option, but the user did not choose it.
 */
export function endApproval(approval: ToolApproval, result: KiroPermissionResult): ToolApproval {
  return result.outcome === 'answered'
    ? {
        requestId: approval.requestId,
        state: 'answered',
        ...(result.kind && { kind: result.kind }),
        ...(approval.review && { review: true }),
      }
    : {
        requestId: approval.requestId,
        state: 'not-answered',
        ...(approval.review && { review: true }),
      };
}

/** The stored form. An approval that is still open when the reply ends is not answered. */
export function toStoredApproval(approval: ToolApproval): StoredToolApproval {
  return {
    requestId: approval.requestId,
    state: approval.state === 'answered' ? 'answered' : 'not-answered',
    ...(approval.state === 'answered' && approval.kind && { kind: approval.kind }),
    ...(approval.review && { review: true }),
  };
}

/** Stored approvals of a tool call from the database; drops what is not valid */
export function readStoredApprovals(value: unknown): StoredToolApproval[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const approvals: StoredToolApproval[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !shortString(entry.requestId, MAX_ID)) continue;
    const answered = entry.state === 'answered';
    approvals.push({
      requestId: entry.requestId,
      state: answered ? 'answered' : 'not-answered',
      ...(answered && shortString(entry.kind, MAX_ID) && { kind: entry.kind }),
      ...(entry.review === true && { review: true }),
    });
  }
  return approvals.length > 0 ? approvals : undefined;
}

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  allow_once: 'Allowed',
  allow_always: 'Always allowed',
  reject_once: 'Denied',
  reject_always: 'Always denied',
};

/**
 * The answer in words: "Allowed", "Always denied", "Changes accepted", "Not answered", or
 * "Waiting for your answer" while it is open.
 */
export function approvalWords(approval: Pick<ToolApproval, 'state' | 'kind' | 'review'>): string {
  if (approval.state === 'open') return 'Waiting for your answer';
  if (approval.state === 'not-answered') return 'Not answered';
  if (approval.review) {
    if (isRejectKind(approval.kind)) return 'Changes rejected';
    return approval.kind?.startsWith('allow') ? 'Changes accepted' : 'Answered';
  }
  return (approval.kind && ANSWER_WORDS[approval.kind]) ?? 'Answered';
}

/**
 * What the tool call's outcome is because of its last approval: `denied` when the user chose a
 * reject option, `not-answered` when the question ended without an answer. Undefined when the
 * approvals do not explain the outcome (allowed, or no question): a failed tool then failed.
 */
export function approvalOutcome(
  approvals: readonly Pick<ToolApproval, 'state' | 'kind'>[] | undefined
): 'denied' | 'not-answered' | undefined {
  const last = approvals?.at(-1);
  if (!last || last.state === 'open') return undefined;
  if (last.state === 'not-answered') return 'not-answered';
  return isRejectKind(last.kind) ? 'denied' : undefined;
}

/** The open question of a set of approvals, if any */
export function openQuestion(
  approvals: readonly ToolApproval[] | undefined
): ToolApproval | undefined {
  return approvals?.find((a) => a.state === 'open');
}

/**
 * The work row's line for an open question: "Kiro wants to run `echo hi > hello.txt`",
 * "Kiro wants you to review the changes", or "Kiro wants to use Write File · notes.txt".
 */
export function questionLine(
  approval: Pick<ToolApproval, 'title' | 'command' | 'resource' | 'review'>
): string {
  const shorten = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text);
  if (approval.review) return 'Kiro wants you to review the changes';
  if (approval.command) return `Kiro wants to run \`${shorten(approval.command)}\``;
  const title = approval.title ? shorten(approval.title) : '';
  const resource = approval.resource ? shorten(approval.resource) : '';
  if (title && resource) return `Kiro wants to use ${title} · ${resource}`;
  if (title || resource) return `Kiro wants to use ${title || resource}`;
  return 'Waiting for your answer';
}
