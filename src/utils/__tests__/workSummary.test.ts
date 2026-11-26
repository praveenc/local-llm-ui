import { describe, expect, it } from 'vitest';

import type { ToolCallPart } from '../../types/ai-messages';
import { shortToolName, toStoredToolCall, toolLabel, toolResultText } from '../toolResults';
import { currentStep, summarizeWork, thoughtLabel } from '../workSummary';

const call = (overrides: Partial<ToolCallPart>): ToolCallPart => ({
  type: 'tool-call',
  toolCallId: Math.random().toString(36).slice(2),
  toolName: 'webSearch',
  args: {},
  status: 'complete',
  ...overrides,
});

const search = (query: string, urls: string[], status: ToolCallPart['status'] = 'complete') =>
  call({
    args: { query },
    status,
    result: { provider: 'brave', results: urls.map((url) => ({ title: url, url, content: 'x' })) },
  });

describe('summarizeWork', () => {
  it('counts thinking, searches, unique sources and other tools', () => {
    const summary = summarizeWork({
      hasReasoning: true,
      reasoningMs: 4200,
      toolCalls: [
        search('a', ['https://a.test/1', 'https://b.test/2']),
        search('b', ['https://b.test/2', 'https://c.test/3']),
        call({ toolName: 'fetchv2__fetch', args: { url: 'https://a.test/1' } }),
      ],
    });
    expect(summary.parts).toEqual(['Thought 4 s', '2 searches', '3 sources', '1 fetch call']);
    expect(summary.failed).toBe(0);
  });

  it('counts a search that failed on every provider as failed', () => {
    const failedSearch = call({
      args: { query: 'q' },
      result: {
        query: 'q',
        results: [],
        failures: ['Brave Search: HTTP 422 (SUBSCRIPTION_TOKEN_INVALID)'],
        error: 'Web search failed. Brave Search: HTTP 422 (SUBSCRIPTION_TOKEN_INVALID)',
      },
    });
    const summary = summarizeWork({
      hasReasoning: false,
      toolCalls: [failedSearch, failedSearch, search('ok', ['https://a.test/1'])],
    });
    expect(summary.parts).toEqual(['3 searches', '1 source']);
    expect(summary.failed).toBe(2);
  });

  it('keeps a failed search failed after it is stored', () => {
    const stored = toStoredToolCall(
      call({
        result: {
          query: 'q',
          results: [],
          failures: ['Exa: HTTP 401'],
          error: 'Web search failed. Exa: HTTP 401',
        },
      })
    );
    expect(
      summarizeWork({ hasReasoning: false, toolCalls: [{ type: 'tool-call', ...stored }] }).failed
    ).toBe(1);
  });

  it('does not count a search that a fallback provider answered as failed', () => {
    const summary = summarizeWork({
      hasReasoning: false,
      toolCalls: [
        call({
          result: {
            provider: 'exa',
            failures: ['Brave Search: HTTP 429'],
            results: [{ title: 't', url: 'https://a.test/1', content: 'x' }],
          },
        }),
      ],
    });
    expect(summary.failed).toBe(0);
  });

  it('counts many different tools as tool calls, and failures on their own', () => {
    const summary = summarizeWork({
      hasReasoning: false,
      toolCalls: [
        call({ toolName: 'read_file' }),
        call({ toolName: 'list_dir' }),
        call({ toolName: 'grep', status: 'error' }),
      ],
    });
    expect(summary.parts).toEqual(['3 tool calls']);
    expect(summary.failed).toBe(1);
  });

  it('says one search and one source in the singular', () => {
    expect(
      summarizeWork({ hasReasoning: false, toolCalls: [search('q', ['https://a.test'])] }).parts
    ).toEqual(['1 search', '1 source']);
  });
});

describe('thoughtLabel', () => {
  it('shows seconds or minutes, and no time when it is not known', () => {
    expect(thoughtLabel(undefined)).toBe('Thought');
    expect(thoughtLabel(400)).toBe('Thought');
    expect(thoughtLabel(4400)).toBe('Thought 4 s');
    expect(thoughtLabel(65_000)).toBe('Thought 1 min 5 s');
  });
});

describe('currentStep', () => {
  it('names the tool that waits for its result', () => {
    expect(
      currentStep({
        hasReasoning: true,
        hasText: false,
        toolCalls: [search('done', []), search('riemann zeros primes', [], 'pending')],
      })
    ).toBe('Searching “riemann zeros primes”');
    expect(
      currentStep({
        hasReasoning: false,
        hasText: false,
        toolCalls: [
          call({
            toolName: 'fetchv2__fetch',
            args: { url: 'https://a.test/x' },
            status: 'pending',
          }),
        ],
      })
    ).toBe('Running fetch · https://a.test/x');
  });

  it('says Thinking before the answer, Working after tools, and nothing once text streams', () => {
    expect(currentStep({ hasReasoning: true, hasText: false, toolCalls: [] })).toBe('Thinking…');
    expect(currentStep({ hasReasoning: true, hasText: false, toolCalls: [search('q', [])] })).toBe(
      'Working…'
    );
    expect(currentStep({ hasReasoning: true, hasText: true, toolCalls: [] })).toBeUndefined();
  });
});

describe('tool results', () => {
  it('shortens MCP tool names', () => {
    expect(shortToolName('fetchv2__fetch')).toBe('fetch');
    expect(shortToolName('webSearch')).toBe('webSearch');
    // Kiro's MCP tools: @server/tool
    expect(shortToolName('@fetch/fetch_url')).toBe('fetch_url');
  });

  it('reads Kiro tool names as words', () => {
    expect(toolLabel('run_command', 'kiro')).toBe('run command');
    expect(toolLabel('@github/list_issues', 'kiro')).toBe('list issues');
    expect(toolLabel('read', 'kiro')).toBe('read');
  });

  it('keeps the MCP tool names of other providers', () => {
    expect(toolLabel('fetchv2__fetch_url', 'bedrock')).toBe('fetch_url');
    expect(toolLabel('fetch_url')).toBe('fetch_url');
    expect(
      summarizeWork({
        hasReasoning: false,
        provider: 'bedrock',
        toolCalls: [call({ toolName: 'fetchv2__fetch_url' })],
      }).parts
    ).toEqual(['1 fetch_url call']);
  });
});

describe('Kiro tool calls in the work row', () => {
  it('names Kiro tools in words and counts a tool error with no question as failed', () => {
    const summary = summarizeWork({
      hasReasoning: false,
      provider: 'kiro',
      toolCalls: [
        call({
          toolName: 'run_command',
          args: { command: 'ls' },
          status: 'error',
          result: 'Command exited with status 1',
        }),
      ],
    });
    expect(summary.parts).toEqual(['1 run command call']);
    expect(summary.failed).toBe(1);
    expect(summary.denied).toBe(0);
    expect(
      currentStep({
        hasReasoning: false,
        hasText: false,
        provider: 'kiro',
        toolCalls: [call({ toolName: 'read_file', args: { path: 'a.ts' }, status: 'pending' })],
      })
    ).toBe('Running read file · a.ts');
  });

  it('reads the text of an MCP result', () => {
    expect(
      toolResultText({
        content: [
          { type: 'text', text: 'one' },
          { type: 'image', data: '…' },
          { type: 'text', text: 'two' },
        ],
      })
    ).toBe('one\n\ntwo');
    expect(toolResultText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('stores a search with short snippets and at most 10 results', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://s${i}.test`);
    const stored = toStoredToolCall({
      ...search('q', urls),
      result: {
        provider: 'exa',
        results: urls.map((url) => ({ title: 'T', url, content: 'y'.repeat(1000) })),
      },
    });
    const result = stored.result as { provider: string; results: Array<{ content: string }> };
    expect(stored).not.toHaveProperty('type');
    expect(result.provider).toBe('exa');
    expect(result.results).toHaveLength(10);
    expect(result.results[0].content.length).toBe(401);
  });

  it('stores other output as text of at most 8,000 characters', () => {
    const stored = toStoredToolCall(
      call({ toolName: 'fetch', result: { content: [{ type: 'text', text: 'z'.repeat(9000) }] } })
    );
    expect(typeof stored.result).toBe('string');
    expect((stored.result as string).length).toBe(8001);
  });

  it('stores a tool without a result as failed', () => {
    const stored = toStoredToolCall(call({ toolName: 'fetch', status: 'pending' }));
    expect(stored.status).toBe('error');
    expect(stored.result).toMatch(/ended before this tool returned/);
  });
});

describe('Kiro questions in the work row', () => {
  const question = {
    requestId: 'r1',
    state: 'open' as const,
    title: 'echo hi > hello.txt',
    command: 'echo hi > hello.txt',
    options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }],
  };

  it('counts a denied tool as denied, not failed', () => {
    const summary = summarizeWork({
      hasReasoning: false,
      provider: 'kiro',
      toolCalls: [
        call({
          toolName: 'shell',
          status: 'error',
          result: 'The user rejected this tool call',
          approvals: [{ requestId: 'r1', state: 'answered', kind: 'reject_once' }],
        }),
        call({
          toolName: 'shell',
          status: 'error',
          result: 'Command failed',
          approvals: [{ requestId: 'r2', state: 'answered', kind: 'allow_once' }],
        }),
        call({
          toolName: 'shell',
          status: 'error',
          approvals: [{ requestId: 'r3', state: 'not-answered' }],
        }),
      ],
    });
    expect(summary).toMatchObject({ failed: 1, denied: 1, notAnswered: 1 });
  });

  it('says "Waiting for your answer" as the current step, before a pending tool, with no command', () => {
    expect(
      currentStep({
        hasReasoning: false,
        hasText: true,
        provider: 'kiro',
        toolCalls: [
          call({ toolName: 'read_file', args: { path: 'a.ts' }, status: 'pending' }),
          call({ toolName: 'shell', status: 'pending', approvals: [question] }),
        ],
      })
    ).toBe('Waiting for your answer');
  });

  it('stores a denied tool as denied, and an open question as not answered', () => {
    const denied = toStoredToolCall(
      call({
        toolName: 'shell',
        status: 'error',
        approvals: [{ requestId: 'r1', state: 'answered', kind: 'reject_once' }],
      })
    );
    const open = toStoredToolCall(
      call({ toolName: 'shell', status: 'pending', approvals: [question] })
    );
    expect(denied.approvals).toEqual([{ requestId: 'r1', state: 'answered', kind: 'reject_once' }]);
    expect(open.approvals).toEqual([{ requestId: 'r1', state: 'not-answered' }]);
    const summary = summarizeWork({
      hasReasoning: false,
      toolCalls: [denied, open].map((t) => ({ type: 'tool-call' as const, ...t })),
    });
    expect(summary).toMatchObject({ failed: 0, denied: 1, notAnswered: 1 });
  });

  it('stores no approvals field for a tool without a question', () => {
    expect(toStoredToolCall(call({ toolName: 'shell' }))).not.toHaveProperty('approvals');
  });
});
