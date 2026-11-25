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
import type { KiroStatus } from '../utils/kiroStatus';
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

export class KiroService {
  /** The state of kiro-cli on the computer that runs the app; `refresh` skips the server cache */
  async getStatus(refresh = false): Promise<KiroStatus> {
    const response = await fetch(`/api/kiro/status${refresh ? '?refresh=1' : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as KiroStatus;
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
    const body = (await response.json()) as { models?: unknown };
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
    return session;
  }
}

export const kiroService = new KiroService();
