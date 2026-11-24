import type { KiroLoginEvent, KiroLoginMethod } from '../utils/kiroLogin';
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
    // Returns true at [DONE]
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

  /** Stops the sign-in that runs. Resolves with false when none runs. */
  async cancelLogin(): Promise<boolean> {
    const response = await fetch('/api/kiro/login/cancel', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
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

  // Kiro lists no models until the chat works
  async getModels(): Promise<ModelInfo[]> {
    return [];
  }
}

export const kiroService = new KiroService();
