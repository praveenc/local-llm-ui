/**
 * Permission requests of an ACP agent (session/request_permission).
 *
 * The default answer is a denial. An answer is always one of the request's own options. Where the
 * app picks one itself, it chooses by kind and never by id. A handler that fails, does not answer
 * in time, or answers an option that the request does not list gets the reject_once option.
 */
import type {
  Loose,
  PermissionOption,
  PermissionOptionKind,
  PermissionOutcome,
  PermissionRequest,
} from './types.ts';

export type PermissionDecision = { optionId: string } | 'cancelled';

/** The agent-wide handler. Default: deny. */
export type PermissionHandler = (input: {
  sessionId: string;
  request: PermissionRequest;
  /** Aborts when the prompt is cancelled or ends */
  signal: AbortSignal;
}) => Promise<PermissionDecision> | PermissionDecision;

/** One permission request of one prompt, for the chat that asked */
export interface PermissionQuestion {
  /** A random id for this request, for the answer from the browser */
  requestId: string;
  toolCallId: string;
  title?: string;
  options: PermissionOption[];
  /** The request's own `_meta`, for the harness adapter */
  meta?: Loose;
  /** Aborts when the prompt is cancelled or ends, and when this question ends */
  signal: AbortSignal;
}

/**
 * How a question ended. `answered`: the handler chose one of the request's options. `cancelled`:
 * the prompt was cancelled or ended, or the handler cancelled. `timeout`: no valid answer in time
 * (also a handler that failed or chose an option that the request does not list); the agent got
 * the reject_once option.
 */
export type PermissionEndKind = 'answered' | 'cancelled' | 'timeout';

/** The end of one question of a prompt, for the chat that asked */
export interface PermissionEnd {
  requestId: string;
  toolCallId: string;
  end: PermissionEndKind;
  /** The option that the agent got, if any */
  optionId?: string;
  /** The kind of that option */
  kind?: string;
}

export type PromptPermissionHandler = (
  question: PermissionQuestion
) => Promise<PermissionDecision> | PermissionDecision;

/** The option of this kind, by kind and never by id */
export function optionIdForKind(
  request: PermissionRequest,
  kind: PermissionOptionKind
): string | undefined {
  return request.options.find((o) => o.kind === kind)?.optionId;
}

export const denyPermission: PermissionHandler = ({ request }) => {
  const optionId = optionIdForKind(request, 'reject_once');
  return optionId ? { optionId } : 'cancelled';
};

const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

/**
 * Asks a handler and turns its decision into the answer for the agent. A handler that never
 * answers must not hold the reply: the signal and a timeout answer for it.
 */
export async function answerPermission(input: {
  /** The request's options (an empty list when the request had none) */
  options: PermissionOption[];
  signal: AbortSignal;
  timeoutMs: number;
  /** True once the prompt was cancelled */
  cancelled: () => boolean;
  ask: () => Promise<PermissionDecision>;
}): Promise<{ outcome: PermissionOutcome; end: PermissionEndKind }> {
  const { options, signal } = input;
  const cancelled = {
    outcome: { outcome: { outcome: 'cancelled' } } as PermissionOutcome,
    end: 'cancelled' as const,
  };
  const reject = () => {
    const optionId = options.find((o) => o.kind === 'reject_once')?.optionId;
    const outcome: PermissionOutcome = optionId
      ? { outcome: { outcome: 'selected', optionId } }
      : { outcome: { outcome: 'cancelled' } };
    return { outcome, end: 'timeout' as const };
  };
  let timer: NodeJS.Timeout | undefined;
  const answer = await Promise.race([
    input.ask().then(
      (decision) => ({ decision }),
      () => 'failed' as const
    ),
    aborted(signal).then(() => 'cancelled' as const),
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), input.timeoutMs);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  if (input.cancelled() || answer === 'cancelled') return cancelled;
  if (answer === 'failed' || answer === 'timeout') return reject();
  const { decision } = answer;
  if (decision === 'cancelled') return cancelled;
  if (!options.some((o) => o.optionId === decision.optionId)) return reject();
  return {
    outcome: { outcome: { outcome: 'selected', optionId: decision.optionId } },
    end: 'answered',
  };
}
