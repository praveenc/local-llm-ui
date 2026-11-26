/**
 * POST /api/kiro/chat: one Kiro reply as SSE.
 *
 * The route opens the chat's Kiro session (or a new one), sets the model and the Thinking level
 * when they changed, sends the new message with the messages that Kiro has not seen (D12), and
 * maps Kiro's updates to the app's SSE events. Kiro's permission questions go to the browser as
 * `permission` events (D16); the answer comes back through POST /api/kiro/permission and the shared
 * registry. Every question that was sent ends with a `permissionResult` event. While a question is
 * open, a `: ping` comment every 15 s keeps a tunnel from closing the idle stream.
 *
 * The `session` event comes right before session/prompt: after the session is open, after a
 * running or cancelling reply in it ended, and after the options are set. The browser counts the
 * message as seen only when that event came. When the request ends before it, a session that this
 * request made is deleted again, so no empty session stays on disk.
 *
 * The folder of a session never comes from the browser: a new session uses the app's Kiro folder,
 * and an existing one uses the folder in its own session.json. Logs lifecycle lines only: never
 * the prompt, the history, tool input or output, or the title.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import {
  KIRO_STOP_NOTICES,
  buildKiroPrompt,
  kiroSessionIsStale,
  parseKiroChatRequest,
  unseenMessages,
} from '../../src/utils/kiroChat.ts';
import type { KiroChatEvent, KiroChatRequest } from '../../src/utils/kiroChat.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import type { PermissionRegistry } from '../acp/permission-registry.ts';
import type { PromptPermissionHandler } from '../acp/permissions.ts';
import { createUpdateMapper } from '../acp/updates.ts';
import type { AcpStreamEvent } from '../acp/updates.ts';
import { endStreamWithError, readBodyWithLimit } from '../security.ts';
import {
  AcpError,
  KiroBusyError,
  KiroCancelTimeoutError,
  KiroCrashedError,
  KiroNotInstalledError,
  KiroOptionError,
  KiroSessionError,
  KiroSignedOutError,
} from './agent.ts';
import type { KiroAgent } from './agent.ts';
import { kiroPermissionResult, kiroQuestion } from './approvals.ts';
import { defaultKiroEnvironment } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import { applyOptions } from './chat-options.ts';
import { kiroLeaseErrorText } from './lease.ts';
import type { KiroModelList } from './models.ts';
import { createKiroReplyMeta, kiroToolName } from './reply-meta.ts';
import { findKiroSessionCwd } from './session-files.ts';

const PING_MS = 15_000;
const BUSY_TEXT = 'Kiro is still answering in this chat. Wait for the reply, or click Stop.';
/** The text for an error that the route does not know: the detail goes to the terminal only */
export const KIRO_CHAT_FAILED = 'Kiro failed. See the terminal that runs npm run dev.';

export type KiroChatAgent = Pick<
  KiroAgent,
  | 'state'
  | 'newSession'
  | 'ensureSession'
  | 'setOption'
  | 'configOptions'
  | 'sessionInfo'
  | 'prompt'
  | 'deleteSession'
  | 'closeSession'
  | 'isBusy'
  | 'waitForIdle'
  | 'cancelWaitMs'
>;

export interface KiroChatHandlerOptions {
  agent: KiroChatAgent;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  models: Pick<KiroModelList, 'update'>;
  /** The open questions, shared with POST /api/kiro/permission */
  permissions: Pick<PermissionRegistry, 'ask'>;
  /** How often an open question sends a `: ping` comment. Default 15 s. Tests make it short. */
  pingMs?: number;
  /** Where Kiro keeps its sessions (the home folder). Default: the real computer. */
  environment?: KiroEnvironment;
  bodyLimit?: number;
  /**
   * How long a request waits for a running or cancelling reply in the same session to end.
   * Default: the agent's cancelWait (30 s). Tests make it short.
   */
  busyWaitMs?: number;
}

type ChatEvent =
  | KiroChatEvent
  | AcpStreamEvent
  | {
      metadata: {
        usage: { credits?: number; contextPercent?: number };
        latencyMs?: number;
      };
    }
  | { error: string };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** The clear text for an error after the stream started */
function errorText(error: unknown): string {
  // Another program holds the session: Kiro's own text says which one (K7)
  const lease = kiroLeaseErrorText(error);
  if (lease) return lease;
  if (error instanceof KiroSignedOutError) {
    return 'Kiro is not signed in. Sign in in Preferences → Providers.';
  }
  if (error instanceof KiroNotInstalledError) return 'Kiro CLI is not installed.';
  if (error instanceof KiroBusyError) return BUSY_TEXT;
  if (error instanceof KiroCrashedError)
    return 'Kiro stopped during the reply. Send the message again.';
  if (
    error instanceof KiroCancelTimeoutError ||
    error instanceof KiroSessionError ||
    error instanceof KiroOptionError
  ) {
    return error.message;
  }
  // Other messages can hold paths or text from inside kiro-cli: the terminal gets them
  return KIRO_CHAT_FAILED;
}

const aborted = (signal: AbortSignal) =>
  new Promise<false>((resolve) => {
    if (signal.aborted) resolve(false);
    else signal.addEventListener('abort', () => resolve(false), { once: true });
  });

export function createKiroChatHandler(options: KiroChatHandlerOptions) {
  const { agent, statusReader, models } = options;
  /** Requests that use each session now: the last one closes it (K7) */
  const inUse = new Map<string, number>();

  /** Opens the chat's session, or a new one. Returns the session and whether it is new. */
  async function openSession(request: KiroChatRequest) {
    if (request.sessionId && !kiroSessionIsStale(request)) {
      const home = (options.environment ?? defaultKiroEnvironment()).home;
      const cwd = await findKiroSessionCwd(request.sessionId, { home });
      if (cwd) {
        try {
          await agent.ensureSession(request.sessionId, cwd);
          return { id: request.sessionId, created: false };
        } catch (error) {
          // A damaged session on disk fails session/load with an ACP error: start a new one
          if (!(error instanceof KiroSessionError) && !(error instanceof AcpError)) throw error;
          console.warn('[kiro] could not open the chat session, starting a new one');
        }
      }
    }
    const { sessionId } = await agent.newSession();
    return { id: sessionId, created: true };
  }

  return async function handleKiroChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBodyWithLimit(req, res, options.bodyLimit);
    if (body === null) return;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'The request body is not valid JSON' });
      return;
    }
    const parsed = parseKiroChatRequest(json);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const request = parsed.value;

    const status = await statusReader.read();
    if (status.state === 'not-installed') {
      sendJson(res, 503, { error: 'Kiro CLI is not installed.' });
      return;
    }
    if (status.state === 'unsupported') {
      sendJson(res, 503, {
        error: `Kiro CLI ${status.version} is not supported. Install Kiro CLI 3.`,
      });
      return;
    }
    if (status.state === 'error') {
      sendJson(res, 503, { error: `Could not check Kiro CLI: ${status.message}` });
      return;
    }
    if (status.state !== 'signed-in') {
      sendJson(res, 401, { error: 'Sign in to Kiro in Preferences → Providers.' });
      return;
    }

    const started = Date.now();
    let stopReason = 'error';
    let logged = false;
    const logEnd = () => {
      if (logged) return;
      logged = true;
      console.log(`[kiro] chat reply ended: ${stopReason} (${Date.now() - started} ms)`);
    };
    const controller = new AbortController();
    // A session that this request made, until session/prompt is sent: deleted when the request
    // ends before that, so no empty session stays on disk
    let unused: string | undefined;
    // The ping timers of the open questions
    const pings = new Set<NodeJS.Timeout>();
    // The session that this request counts in `inUse` (K7)
    let using: string | undefined;
    try {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      // The browser clicked Stop or closed the page
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const send = (event: ChatEvent) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      if (!agent.state().running) send({ status: 'Starting Kiro…' });
      const session = await openSession(request);
      const { id } = session;
      if (session.created) unused = id;
      using = id;
      inUse.set(id, (inUse.get(id) ?? 0) + 1);
      models.update(agent.configOptions(id));
      const unseen = unseenMessages(request.history, request.seenMessages, session.created);

      // A reply that runs or is cancelling (Stop, then a quick resend) ends first: no option may
      // change during it
      if (agent.isBusy(id)) {
        const idle = await Promise.race([
          agent.waitForIdle(id, options.busyWaitMs ?? agent.cancelWaitMs),
          aborted(controller.signal),
        ]);
        if (controller.signal.aborted) {
          stopReason = 'cancelled';
          return;
        }
        if (!idle) {
          stopReason = 'busy';
          endStreamWithError(res, BUSY_TEXT);
          return;
        }
      }
      if (controller.signal.aborted) {
        stopReason = 'cancelled';
        return;
      }

      const optionError = await applyOptions(agent, id, request);
      if (optionError) {
        stopReason = 'option-error';
        endStreamWithError(res, optionError);
        return;
      }
      if (controller.signal.aborted) {
        stopReason = 'cancelled';
        return;
      }
      // Right before session/prompt: the browser counts the message as seen only after this
      unused = undefined;
      send({ session });

      const meta = createKiroReplyMeta({
        prompt: request.prompt,
        title: agent.sessionInfo(id)?.title,
        send,
      });
      const mapper = createUpdateMapper({ send, toolName: kiroToolName, onOther: meta.onUpdate });
      const onPermission: PromptPermissionHandler = (question) => {
        send({ permission: kiroQuestion(question) });
        const ping = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
        }, options.pingMs ?? PING_MS);
        ping.unref();
        pings.add(ping);
        const stop = () => {
          clearInterval(ping);
          pings.delete(ping);
        };
        if (question.signal.aborted) stop();
        else question.signal.addEventListener('abort', stop, { once: true });
        return options.permissions.ask(question);
      };

      stopReason = await agent.prompt(
        id,
        [{ type: 'text', text: buildKiroPrompt(unseen, request.prompt) }],
        {
          onUpdate: mapper.onUpdate,
          signal: controller.signal,
          onPermission,
          onPermissionEnd: (end) => send({ permissionResult: kiroPermissionResult(end) }),
        }
      );

      // A reply with no text that Kiro ended with an error (for example, no credits left)
      if (!mapper.hasText && meta.displayError && stopReason !== 'cancelled') {
        send({ content: `\n\n_${meta.displayError}_` });
      }
      if (stopReason !== 'end_turn' && stopReason !== 'cancelled') {
        const notice = KIRO_STOP_NOTICES[stopReason] ?? 'Kiro stopped the reply.';
        send({ content: `\n\n_${notice}_` });
      }
      const { credits, elapsedMs } = meta;
      const contextPercent = meta.contextPercent ?? agent.sessionInfo(id)?.contextPercent;
      send({
        metadata: {
          usage: {
            ...(credits !== undefined && { credits }),
            ...(contextPercent !== undefined && { contextPercent }),
          },
          latencyMs: elapsedMs ?? Date.now() - started,
        },
      });
      if (!res.writableEnded && !res.destroyed) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      logEnd();
      // Every question of this reply ended when the prompt ended (K6): stop its pings now
      for (const ping of pings) clearInterval(ping);
      pings.clear();
      // Release the session so that the terminal can resume it (K7), unless another request
      // waits for it. After the reply ends, so a slow close does not keep it streaming. Only
      // after a prompt that ended here: after Kiro's lease error the session belongs to the
      // other program.
      if (inUse.get(id) === 1) await agent.closeSession(id).catch(() => undefined);
    } catch (error) {
      // The error's class and message only: never the request
      console.warn(
        `[kiro] chat failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`
      );
      if (!endStreamWithError(res, errorText(error))) {
        sendJson(res, 500, { error: errorText(error) });
      }
    } finally {
      for (const ping of pings) clearInterval(ping);
      pings.clear();
      if (using) {
        const left = (inUse.get(using) ?? 1) - 1;
        if (left > 0) inUse.set(using, left);
        else inUse.delete(using);
      }
      if (!res.writableEnded && !res.destroyed) res.end();
      if (unused) {
        try {
          await agent.deleteSession(unused);
        } catch {
          // The session stays on disk; no conversation refers to it
        }
      }
      logEnd();
    }
  };
}
