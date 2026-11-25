/**
 * POST /api/kiro/chat: one Kiro reply as SSE.
 *
 * The route opens the chat's Kiro session (or a new one), sets the model and the Thinking level
 * when they changed, sends the new message with the messages that Kiro has not seen (D12), and
 * maps Kiro's updates to the app's SSE events. Every permission request is denied (D7) until the
 * approvals of K6.
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
  KIRO_DENIED_TOOL,
  KIRO_STOP_NOTICES,
  buildKiroPrompt,
  kiroSessionIsStale,
  parseKiroChatRequest,
  unseenMessages,
} from '../../src/utils/kiroChat.ts';
import type { KiroChatEvent, KiroChatRequest } from '../../src/utils/kiroChat.ts';
import { kiroEffortSetting, parseKiroModels } from '../../src/utils/kiroModels.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { endStreamWithError, readBodyWithLimit } from '../security.ts';
import type { ConfigOption, SessionUpdate, ToolCallUpdate } from '../acp/types.ts';
import {
  AcpError,
  KiroBusyError,
  KiroCancelTimeoutError,
  KiroCrashedError,
  KiroNotInstalledError,
  KiroOptionError,
  KiroSessionError,
  KiroSignedOutError,
  optionIdForKind,
} from './agent.ts';
import type { KiroAgent, PromptPermissionHandler } from './agent.ts';
import { defaultKiroEnvironment } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import type { KiroModelList } from './models.ts';
import { findKiroSessionCwd } from './session-files.ts';

const MAX_TOOL_OUTPUT = 20_000;
/** Lower case, single spaces, no punctuation at the end: to compare a title with the prompt */
const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?:;,…]+$/u, '');

/**
 * Kiro's first focus_update title is the start of the prompt itself, before Kiro makes a short
 * title. That one is not sent: the app's own title from the first message is the same text.
 */
export function isPromptEcho(title: string, prompt: string): boolean {
  const t = comparable(title);
  return t.length > 0 && comparable(prompt).startsWith(t);
}

/** An MCP tool's title is `@server/tool` */
const MCP_TITLE = /^@\S/;
/** The tool id at the start of Kiro's toolCallId: `run_command_toolu_bdrk_01…` */
const TOOL_ID = /^([a-z][a-z0-9_]*?)_tool(?:u|use)_/;
/** A display_error notice is cut to this size */
const MAX_DISPLAY_ERROR = 300;

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
  | 'isBusy'
  | 'waitForIdle'
  | 'cancelWaitMs'
>;

export interface KiroChatHandlerOptions {
  agent: KiroChatAgent;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  models: Pick<KiroModelList, 'update'>;
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
  | { content: string }
  | { reasoning: string }
  | { toolCall: { id: string; name: string; args: Record<string, unknown> } }
  | { toolResult: { id: string; name: string; result?: string; error?: string } }
  | {
      metadata: {
        usage: { credits?: number; contextPercent?: number };
        latencyMs?: number;
      };
    }
  | { error: string };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** The name that the work row shows for a Kiro tool call */
export function kiroToolName(update: Pick<ToolCallUpdate, 'toolCallId' | 'title' | 'kind'>) {
  if (typeof update.title === 'string' && MCP_TITLE.test(update.title)) return update.title;
  const id = typeof update.toolCallId === 'string' ? TOOL_ID.exec(update.toolCallId)?.[1] : '';
  if (id) return id;
  if (typeof update.kind === 'string' && update.kind) return update.kind;
  return 'tool';
}

/** The text of a tool's output: the text items of `content`, else rawOutput */
export function kiroToolOutput(update: Pick<ToolCallUpdate, 'content' | 'rawOutput'>): string {
  const texts: string[] = [];
  for (const item of Array.isArray(update.content) ? update.content : []) {
    const inner = asRecord(asRecord(item)?.content);
    if (asRecord(item)?.type === 'content' && inner?.type === 'text') {
      if (typeof inner.text === 'string') texts.push(inner.text);
    }
  }
  let text: string;
  if (texts.length > 0) text = texts.join('\n\n');
  else if (typeof update.rawOutput === 'string') text = update.rawOutput;
  else if (update.rawOutput === undefined) text = '';
  else text = JSON.stringify(update.rawOutput) ?? '';
  return text.slice(0, MAX_TOOL_OUTPUT);
}

/** The clear text for an error after the stream started */
function errorText(error: unknown): string {
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

const listsValue = (option: ConfigOption | undefined, value: string) =>
  option?.options?.some((o) => o.value === value) === true;

export function createKiroChatHandler(options: KiroChatHandlerOptions) {
  const { agent, statusReader, models } = options;

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

  /**
   * Sets the model and the Thinking level when they differ from the session. Returns an error
   * text for the browser, or undefined.
   */
  async function applyOptions(id: string, request: KiroChatRequest): Promise<string | undefined> {
    let current = agent.configOptions(id) ?? [];
    const modelOption = current.find((o) => o.id === 'model');
    if (!listsValue(modelOption, request.model)) {
      return `Kiro does not offer the model ${request.model} any more. Select a different model.`;
    }
    if (modelOption?.currentValue !== request.model) {
      // A model change resets Kiro's effort: read the options again
      current = await agent.setOption(id, 'model', request.model);
    }

    const meta = parseKiroModels(current).find((m) => m.id === request.model);
    const setting = meta && kiroEffortSetting(request.thinkingEffort ?? 'default', meta);
    if (!setting) return undefined;
    const wanted: [string, string | undefined][] = [
      ['effortLevel', setting.effortLevel],
      ['thinking', setting.thinking],
    ];
    for (const [configId, value] of wanted) {
      if (!value) continue;
      const option = current.find((o) => o.id === configId);
      // kiro-cli 3.4 has no effortLevel: skip an option that the session does not have
      if (!listsValue(option, value) || option?.currentValue === value) continue;
      current = await agent.setOption(id, configId, value);
    }
    return undefined;
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
    const controller = new AbortController();
    // A session that this request made, until session/prompt is sent: deleted when the request
    // ends before that, so no empty session stays on disk
    let unused: string | undefined;
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

      const optionError = await applyOptions(id, request);
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

      // The reply's tool calls, by id, and the ones that the app denied
      const tools = new Map<string, { name: string; done: boolean }>();
      const denied = new Set<string>();
      let title = agent.sessionInfo(id)?.title;
      let credits: number | undefined;
      let contextPercent: number | undefined;
      let elapsedMs: number | undefined;
      let hasText = false;
      /** The last display_error that is not an MCP connection error */
      let displayError: string | undefined;

      const announce = (update: ToolCallUpdate) => {
        let tool = tools.get(update.toolCallId);
        if (!tool) {
          tool = { name: kiroToolName(update), done: false };
          tools.set(update.toolCallId, tool);
          const args = asRecord(update.rawInput) ?? {};
          send({ toolCall: { id: update.toolCallId, name: tool.name, args } });
        }
        return tool;
      };

      const onUpdate = (update: SessionUpdate) => {
        switch (update.sessionUpdate) {
          case 'agent_message_chunk':
          case 'agent_thought_chunk': {
            const content = asRecord(update.content);
            if (content?.type !== 'text' || typeof content.text !== 'string') return;
            if (update.sessionUpdate === 'agent_message_chunk') {
              if (content.text) hasText = true;
              send({ content: content.text });
            } else send({ reasoning: content.text });
            return;
          }
          case 'tool_call':
          case 'tool_call_update': {
            const tool = update as ToolCallUpdate;
            if (typeof tool.toolCallId !== 'string' || !tool.toolCallId) return;
            const known = tools.get(tool.toolCallId);
            if (update.sessionUpdate === 'tool_call') {
              announce(tool);
              if (tool.status !== 'completed' && tool.status !== 'failed') return;
            } else if (tool.status !== 'completed' && tool.status !== 'failed') {
              return;
            }
            const entry = known ?? announce(tool);
            if (entry.done) return;
            entry.done = true;
            if (tool.status === 'completed') {
              send({
                toolResult: { id: tool.toolCallId, name: entry.name, result: kiroToolOutput(tool) },
              });
            } else {
              const error = denied.has(tool.toolCallId) ? KIRO_DENIED_TOOL : kiroToolOutput(tool);
              send({ toolResult: { id: tool.toolCallId, name: entry.name, error } });
            }
            return;
          }
          case 'session_info_update': {
            const kiro = asRecord(asRecord(update._meta)?.kiro);
            if (!kiro) return;
            if (kiro.kind === 'focus_update') {
              const next = typeof kiro.title === 'string' ? kiro.title : update.title;
              if (typeof next === 'string' && next && next !== title) {
                title = next;
                if (!isPromptEcho(next, request.prompt)) send({ title: next });
              }
            } else if (
              kiro.kind === 'context_usage' ||
              (kiro.kind === undefined && kiro.contextUsage)
            ) {
              contextPercent =
                asNumber(kiro.usagePercentage) ??
                asNumber(asRecord(kiro.contextUsage)?.usagePercentage) ??
                contextPercent;
            } else if (kiro.kind === 'display_error') {
              // MCP connection errors come on many normal replies
              const detail = asRecord(kiro.displayError);
              const type = kiro.errorType ?? detail?.errorType;
              const message = kiro.message ?? detail?.message;
              if (
                type !== 'mcp_connection_error' &&
                typeof message === 'string' &&
                message.trim()
              ) {
                displayError = message.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_ERROR);
              }
            } else if (kiro.kind === 'turn_completion') {
              for (const summary of Array.isArray(kiro.promptTurnSummaries)
                ? kiro.promptTurnSummaries
                : []) {
                const usage = asNumber(asRecord(summary)?.usage);
                if (asRecord(summary)?.unit === 'credit' && usage !== undefined) {
                  credits = (credits ?? 0) + usage;
                }
              }
              elapsedMs = asNumber(kiro.elapsedTime) ?? elapsedMs;
            }
            return;
          }
          default:
            // available_commands_update, config_option_update, _kiro/*
            return;
        }
      };

      const onPermission: PromptPermissionHandler = (question) => {
        denied.add(question.toolCallId);
        const optionId = optionIdForKind(
          {
            sessionId: id,
            toolCall: { toolCallId: question.toolCallId },
            options: question.options,
          },
          'reject_once'
        );
        return optionId ? { optionId } : 'cancelled';
      };

      stopReason = await agent.prompt(
        id,
        [{ type: 'text', text: buildKiroPrompt(unseen, request.prompt) }],
        { onUpdate, signal: controller.signal, onPermission }
      );

      // A reply with no text that Kiro ended with an error (for example, no credits left)
      if (!hasText && displayError && stopReason !== 'cancelled') {
        send({ content: `\n\n_${displayError}_` });
      }
      if (stopReason !== 'end_turn' && stopReason !== 'cancelled') {
        const notice = KIRO_STOP_NOTICES[stopReason] ?? 'Kiro stopped the reply.';
        send({ content: `\n\n_${notice}_` });
      }
      contextPercent ??= agent.sessionInfo(id)?.contextPercent;
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
    } catch (error) {
      // The error's class and message only: never the request
      console.warn(
        `[kiro] chat failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`
      );
      if (!endStreamWithError(res, errorText(error))) {
        sendJson(res, 500, { error: errorText(error) });
      }
    } finally {
      if (!res.writableEnded && !res.destroyed) res.end();
      if (unused) {
        try {
          await agent.deleteSession(unused);
        } catch {
          // The session stays on disk; no conversation refers to it
        }
      }
      console.log(`[kiro] chat reply ended: ${stopReason} (${Date.now() - started} ms)`);
    }
  };
}
