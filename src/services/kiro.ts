import type { KiroLoginEvent, KiroLoginMethod } from '../utils/kiroLogin';
import { type KiroModel, kiroSupportsThinking } from '../utils/kiroModels';
import type { KiroPermissionAnswer } from '../utils/kiroPermissions';
import {
  type KiroSessionOpenResponse,
  type KiroSessionSummary,
  type KiroSessionWindow,
  parseKiroSessionOpenResponse,
  parseKiroSessionsResponse,
} from '../utils/kiroSessions';
import type {
  KiroFolderSetting,
  KiroSettingsRequest,
  KiroSettingsResponse,
  KiroStatusResponse,
} from '../utils/kiroSettings';
import type { KiroStatus } from '../utils/kiroStatus';
import type { KiroUsage } from '../utils/kiroUsage';
import { type SessionOptionsSnapshot, parseSessionOptionsSnapshot } from '../utils/sessionOptions';
import type { ModelInfo } from './types';

/** The text of an error response ({ error }), or a short message for its status */
async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // The body is not JSON
  }
  return `HTTP error! status: ${response.status}`;
}

/** The picker's hint when Kiro is signed out */
export const KIRO_SIGN_IN_MESSAGE = 'Sign in to Kiro in Preferences → Providers';

/** The error when an answer comes after its question ended */
export const KIRO_QUESTION_ENDED = 'This question has ended';

/** Thrown when Kiro is signed out (401), so a caller can hide what needs Kiro */
export class KiroSignedOutError extends Error {
  constructor() {
    super(KIRO_SIGN_IN_MESSAGE);
    this.name = 'KiroSignedOutError';
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The most sessions whose option lists the tab keeps in memory */
const MAX_REMEMBERED_SESSIONS = 50;

/** The shortest time between two loads of Kiro's default session options (D26) */
export const KIRO_OPTIONS_REFRESH_MS = 60_000;

export class KiroService {
  private readonly now: () => number;

  /** `now`: the clock of the refresh throttle (tests) */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** When the last refresh of the default session options started (D26) */
  private optionsRefreshAt: number | undefined;
  private optionsRefresh: Promise<void> | undefined;

  /** Kiro's default session options, from the models response (a new session) */
  private defaultSessionOptions: SessionOptionsSnapshot | null = null;
  /** The option lists of each Kiro session that this tab has seen (chat or open), in memory */
  private sessionOptions = new Map<string, SessionOptionsSnapshot>();
  private sessionOptionsListeners = new Set<() => void>();

  private sessionOptionsChanged() {
    for (const listener of this.sessionOptionsListeners) listener();
  }

  /** For useSyncExternalStore: called when the defaults or a session's lists change */
  subscribeSessionOptions = (listener: () => void): (() => void) => {
    this.sessionOptionsListeners.add(listener);
    return () => {
      this.sessionOptionsListeners.delete(listener);
    };
  };

  /**
   * The option lists of this Kiro session, when the tab has seen them; else Kiro's defaults from
   * the models response; null when Kiro listed none. The lists are not stored (K9): after a
   * reload, the defaults give the lists and the conversation gives the values.
   */
  getSessionOptions(sessionId?: string): SessionOptionsSnapshot | null {
    return (sessionId && this.sessionOptions.get(sessionId)) || this.defaultSessionOptions;
  }

  /** Takes Kiro's defaults of a new session from a models response; a bad snapshot is null */
  private setDefaultSessionOptions(raw: unknown): void {
    const defaults = raw === undefined ? null : parseSessionOptionsSnapshot(raw);
    if (JSON.stringify(defaults) !== JSON.stringify(this.defaultSessionOptions)) {
      this.defaultSessionOptions = defaults;
      this.sessionOptionsChanged();
    }
  }

  /**
   * Asks the server to load Kiro's default session options again (D26): a running kiro-cli
   * reads its agent files again for each new session, so an agent made in the terminal shows.
   * At most one load per KIRO_OPTIONS_REFRESH_MS for the whole tab, and calls during a load share
   * it. The server makes and deletes one short session and does not read the status again. A
   * failed load keeps the old lists. Never throws.
   */
  refreshDefaultSessionOptions(): Promise<void> {
    if (this.optionsRefresh) return this.optionsRefresh;
    const at = this.now();
    if (
      this.optionsRefreshAt !== undefined &&
      at - this.optionsRefreshAt < KIRO_OPTIONS_REFRESH_MS
    ) {
      return Promise.resolve();
    }
    this.optionsRefreshAt = at;
    this.optionsRefresh = (async () => {
      try {
        const response = await fetch('/api/kiro/models', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ refreshOptions: true }),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { sessionOptions?: unknown };
        // No lists (Kiro gone or signed out): the model query shows that; keep the old lists
        if (body.sessionOptions !== undefined) this.setDefaultSessionOptions(body.sessionOptions);
      } catch (error) {
        console.warn('Could not load the Kiro agent list again:', error);
      } finally {
        this.optionsRefresh = undefined;
      }
    })();
    return this.optionsRefresh;
  }

  /** Keeps the option lists that Kiro reported for a session (chat event or open answer) */
  rememberSessionOptions(sessionId: string, snapshot: SessionOptionsSnapshot): void {
    this.sessionOptions.delete(sessionId);
    this.sessionOptions.set(sessionId, snapshot);
    if (this.sessionOptions.size > MAX_REMEMBERED_SESSIONS) {
      const oldest = this.sessionOptions.keys().next().value;
      if (oldest !== undefined) this.sessionOptions.delete(oldest);
    }
    this.sessionOptionsChanged();
  }

  /**
   * The state of kiro-cli on the computer that runs the app, and the folder for new chats (D6);
   * `refresh` skips the server cache
   */
  async getStatus(refresh = false): Promise<KiroStatusResponse> {
    const response = await fetch(`/api/kiro/status${refresh ? '?refresh=1' : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as KiroStatusResponse;
  }

  /**
   * Sets the folder for new Kiro chats; `null` goes back to the default folder (D6, SEC-21).
   * Resolves with the folder that the server stored. Throws the server's message in words when
   * it refuses the folder. The server never starts Kiro CLI for this call.
   */
  async setWorkspaceDir(workspaceDir: string | null): Promise<KiroFolderSetting> {
    const body: KiroSettingsRequest = { workspaceDir };
    const response = await fetch('/api/kiro/settings', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const { folder } = (await response.json()) as Partial<KiroSettingsResponse>;
    if (!folder || typeof folder.path !== 'string' || typeof folder.isDefault !== 'boolean') {
      throw new Error('The server sent a folder that the app cannot read.');
    }
    return { path: folder.path, isDefault: folder.isDefault };
  }

  /**
   * Starts `kiro-cli login` on the computer that runs the app and calls `onEvent` for each event
   * of the stream. Resolves when the stream ends. Throws when the server answers with an error
   * (409 when a sign-in already runs) or the connection fails. `signal` stops the sign-in.
   */
  async startLogin(
    method: KiroLoginMethod,
    options: { signal?: AbortSignal; onEvent: (event: KiroLoginEvent) => void }
  ): Promise<void> {
    const response = await fetch('/api/kiro/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(method),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(await responseError(response));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    // Returns true at [DONE]. Lines that are not `data:` (the `: ping` comments) are skipped.
    const handle = (block: string): boolean => {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return true;
        try {
          const parsed = JSON.parse(data) as { login?: KiroLoginEvent };
          if (parsed.login) options.onEvent(parsed.login);
        } catch {
          // Skip a line that is not JSON
        }
      }
      return false;
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (handle(block)) {
          void reader.cancel().catch(() => {});
          return;
        }
        end = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handle(buffer);
  }

  /**
   * Stops the sign-in with this run id (from its `started` event). Resolves with false when it
   * does not run any more.
   */
  async cancelLogin(runId: string): Promise<boolean> {
    const response = await fetch('/api/kiro/login/cancel', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ runId }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return ((await response.json()) as { cancelled?: boolean }).cancelled === true;
  }

  /** Runs `kiro-cli logout` and returns the status after it */
  async logout(): Promise<KiroStatus> {
    const response = await fetch('/api/kiro/logout', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    if (!response.ok) throw new Error(await responseError(response));
    return (await response.json()) as KiroStatus;
  }

  /**
   * Sends the user's answer to an open Kiro question. Throws the server's text on an error:
   * "This question has ended" (404) when the question ended before the answer came.
   */
  async answerPermission(answer: KiroPermissionAnswer): Promise<void> {
    const response = await fetch('/api/kiro/permission', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ requestId: answer.requestId, optionId: answer.optionId }),
    });
    if (response.status === 404) throw new Error(KIRO_QUESTION_ENDED);
    if (!response.ok) throw new Error(await responseError(response));
  }

  /**
   * Kiro's models, in Kiro's order. [] when kiro-cli is not installed or too old, so the picker
   * shows no Kiro group. Throws a message for the picker when Kiro is signed out (401) or the
   * server cannot ask Kiro (503). `refresh` skips the server cache.
   */
  async getModels(refresh = false): Promise<ModelInfo[]> {
    // A POST: listing the models can start kiro-cli, so it goes through the JSON check
    const response = await fetch('/api/kiro/models', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(refresh ? { refresh: true } : {}),
    });
    if (response.status === 401) throw new Error(KIRO_SIGN_IN_MESSAGE);
    if (!response.ok) throw new Error(await responseError(response));
    const body = (await response.json()) as { models?: unknown; sessionOptions?: unknown };
    // Kiro's defaults of a new session (K9); a bad snapshot shows no session controls
    this.setDefaultSessionOptions(body.sessionOptions);
    const models = Array.isArray(body.models) ? (body.models as KiroModel[]) : [];
    return models
      .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
      .map(({ id, name, ...kiro }) => ({
        modelId: id,
        modelName: name,
        provider: 'kiro',
        supportsThinking: kiroSupportsThinking(kiro),
        kiro,
      }));
  }

  /**
   * Kiro's sessions of the window, newest first, from Kiro's own list (K7). Throws
   * `KiroSignedOutError` when Kiro is signed out, else an error in words.
   */
  async listSessions(days: KiroSessionWindow): Promise<KiroSessionSummary[]> {
    // A POST: the list can start kiro-cli
    const response = await fetch('/api/kiro/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ days }),
    });
    if (response.status === 401) throw new KiroSignedOutError();
    if (!response.ok) throw new Error(await responseError(response));
    const sessions = parseKiroSessionsResponse(await response.json());
    if (!sessions) throw new Error('Kiro sent a session list that the app cannot read.');
    return sessions;
  }

  /**
   * The turns of a Kiro session after `skipTurns`, as compact messages. Kiro replays the session;
   * nothing in it changes. Throws an error in words.
   */
  async openSession(sessionId: string, skipTurns = 0): Promise<KiroSessionOpenResponse> {
    const response = await fetch('/api/kiro/sessions/open', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId, skipTurns }),
    });
    if (response.status === 401) throw new KiroSignedOutError();
    if (!response.ok) throw new Error(await responseError(response));
    const session = parseKiroSessionOpenResponse(await response.json());
    if (!session) throw new Error('Kiro sent a session that the app cannot read.');
    if (session.sessionOptions) this.rememberSessionOptions(sessionId, session.sessionOptions);
    return session;
  }

  /**
   * The plan and the credits of the Kiro account, or null when Kiro cannot tell (signed out,
   * missing, or an error). A POST: the call can start kiro-cli. The server keeps it 5 minutes.
   */
  async getUsage(): Promise<KiroUsage | null> {
    const response = await fetch('/api/kiro/usage', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    if (!response.ok) throw new Error(await responseError(response));
    const body = (await response.json()) as { usage?: KiroUsage | null };
    return body.usage ?? null;
  }
}

export const kiroService = new KiroService();
