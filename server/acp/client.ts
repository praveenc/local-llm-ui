/**
 * JSON-RPC 2.0 over newline-delimited JSON, as an ACP agent speaks it on stdio.
 * One line is one message. Lines that are not JSON are counted and ignored.
 */
import type { ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';

export const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024;

export class AcpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'AcpError';
    this.code = code;
    this.data = data;
  }
}

export class AcpTimeoutError extends Error {
  readonly method: string;
  constructor(method: string, timeoutMs: number) {
    super(`${method} did not answer in ${timeoutMs / 1000} s`);
    this.name = 'AcpTimeoutError';
    this.method = method;
  }
}

export class AcpClosedError extends Error {
  /** `name` is the agent's name in the text: "The <name> connection closed: …" */
  constructor(reason: string, name = 'agent') {
    super(`The ${name} connection closed: ${reason}`);
    this.name = 'AcpClosedError';
  }
}

export interface CloseInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /**
   * Why the connection closed: 'stream end', 'child exit', an error, or a caller's reason.
   * stdout often closes before the child exits, so `code` is then null: read the exit code from
   * the child's own 'exit' event.
   */
  reason: string;
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (method: string, params: unknown) => Promise<unknown> | undefined;
type CloseHandler = (info: CloseInfo) => void;

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface Message {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface AcpConnectionOptions {
  /** When set, its exit closes the connection and gives the exit code */
  child?: ChildProcess;
  maxLineBytes?: number;
  /** The agent's name in AcpClosedError texts. Default 'agent'. */
  name?: string;
  /** The tag of the log lines: "[tag] …". Default 'acp'. */
  logTag?: string;
}

export class AcpConnection {
  /** Lines that were not JSON-RPC messages */
  ignoredLines = 0;

  private readonly output: Writable;
  private readonly child: ChildProcess | undefined;
  private readonly maxLineBytes: number;
  private readonly name: string;
  private readonly logTag: string;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers: NotificationHandler[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private requestHandler: RequestHandler | undefined;
  private nextId = 1;
  private chunks: Buffer[] = [];
  private buffered = 0;
  private closedInfo: CloseInfo | undefined;

  constructor(input: Readable, output: Writable, options: AcpConnectionOptions = {}) {
    this.output = output;
    this.child = options.child;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.name = options.name ?? 'agent';
    this.logTag = options.logTag ?? 'acp';
    input.on('data', (chunk: Buffer | string) => this.onData(chunk));
    input.on('end', () => this.close('stream end'));
    input.on('close', () => this.close('stream end'));
    input.on('error', (error) => this.close(error.message));
    output.on('error', (error) => this.close(error.message));
    this.child?.once('exit', (code, signal) => this.close('child exit', code, signal));
  }

  /** Over the stdio of a child process */
  static fromChild(child: ChildProcess, options: Omit<AcpConnectionOptions, 'child'> = {}) {
    if (!child.stdout || !child.stdin) throw new Error('The child has no stdio pipes');
    return new AcpConnection(child.stdout, child.stdin, { ...options, child });
  }

  get closed(): boolean {
    return this.closedInfo !== undefined;
  }

  request<T>(method: string, params: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closedInfo)
      return Promise.reject(new AcpClosedError(this.closedInfo.reason, this.name));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { method, resolve: resolve as (v: unknown) => void, reject };
      if (options.timeoutMs !== undefined) {
        const timeoutMs = options.timeoutMs;
        entry.timer = setTimeout(() => {
          // A late answer is dropped; the connection stays open
          this.pending.delete(id);
          reject(new AcpTimeoutError(method, timeoutMs));
        }, timeoutMs);
        entry.timer.unref();
      }
      this.pending.set(id, entry);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  /** The handler returns undefined for a method that it does not know: the agent then gets -32601 */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /** Called once. When the connection is already closed, called at once. */
  onClose(handler: CloseHandler): void {
    if (this.closedInfo) handler(this.closedInfo);
    else this.closeHandlers.push(handler);
  }

  /** Rejects every pending request. Writes nothing after this. */
  close(reason: string, code: number | null = null, signal: NodeJS.Signals | null = null): void {
    if (this.closedInfo) return;
    const exited = this.child && (this.child.exitCode !== null || this.child.signalCode !== null);
    this.closedInfo = {
      reason,
      code: code ?? (exited ? this.child!.exitCode : null),
      signal: signal ?? (exited ? this.child!.signalCode : null),
    };
    this.chunks = [];
    this.buffered = 0;
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new AcpClosedError(reason, this.name));
    }
    for (const handler of this.closeHandlers.splice(0)) handler(this.closedInfo);
  }

  private write(message: Message): void {
    if (this.closedInfo || this.output.destroyed || this.output.writableEnded) return;
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private onData(data: Buffer | string): void {
    if (this.closedInfo) return;
    let chunk = typeof data === 'string' ? Buffer.from(data) : data;
    let newline = chunk.indexOf(0x0a);
    while (newline !== -1) {
      const tail = chunk.subarray(0, newline);
      if (this.buffered + tail.length > this.maxLineBytes) {
        this.close(`a message is larger than ${this.maxLineBytes} bytes`);
        return;
      }
      const line = this.buffered ? Buffer.concat([...this.chunks, tail]) : tail;
      this.chunks = [];
      this.buffered = 0;
      this.onLine(line.toString('utf8'));
      if (this.closedInfo) return;
      chunk = chunk.subarray(newline + 1);
      newline = chunk.indexOf(0x0a);
    }
    if (chunk.length === 0) return;
    if (this.buffered + chunk.length > this.maxLineBytes) {
      this.close(`a message is larger than ${this.maxLineBytes} bytes`);
      return;
    }
    this.chunks.push(Buffer.from(chunk));
    this.buffered += chunk.length;
  }

  private onLine(line: string): void {
    const text = line.trim();
    if (!text) return;
    let message: Message;
    try {
      message = JSON.parse(text) as Message;
    } catch {
      this.ignoredLines += 1;
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.ignoredLines += 1;
      return;
    }
    const hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === 'string') {
      if (!hasId) this.onAgentNotification(message.method, message.params);
      // JSON-RPC allows only a string or a number as an id
      else if (typeof message.id === 'number' || typeof message.id === 'string')
        this.onAgentRequest(message.id, message.method, message.params);
      else this.ignoredLines += 1;
      return;
    }
    if (hasId && typeof message.id === 'number') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (message.error) {
        const { code = -32603, message: text = 'Unknown error', data } = message.error;
        entry.reject(new AcpError(code, text, data));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    this.ignoredLines += 1;
  }

  private onAgentNotification(method: string, params: unknown): void {
    for (const handler of this.notificationHandlers) {
      try {
        handler(method, params);
      } catch (error) {
        console.warn(`[${this.logTag}] notification handler failed: ${(error as Error).message}`);
      }
    }
  }

  private onAgentRequest(id: number | string, method: string, params: unknown): void {
    let answer: Promise<unknown> | undefined;
    try {
      answer = this.requestHandler?.(method, params);
    } catch (error) {
      answer = Promise.reject(error);
    }
    if (!answer) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      return;
    }
    answer.then(
      (result) => this.write({ jsonrpc: '2.0', id, result: result ?? null }),
      (error: unknown) =>
        this.write({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
        })
    );
  }
}
