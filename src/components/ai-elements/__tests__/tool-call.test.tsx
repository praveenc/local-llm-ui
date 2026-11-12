import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolCallPart } from '../../../types/ai-messages';
import { argsSummary } from '../../../utils/toolCallSummary';
import { ToolCall } from '../tool-call';

const part = (overrides: Partial<ToolCallPart>): ToolCallPart => ({
  type: 'tool-call',
  toolCallId: 't1',
  toolName: 'webSearch',
  args: {},
  status: 'complete',
  ...overrides,
});

describe('argsSummary', () => {
  it('prefers the query, then a url or path, then any string', () => {
    expect(argsSummary({ query: 'knowledge graphs', timeRange: 'year' })).toBe('knowledge graphs');
    expect(argsSummary({ url: 'https://a.test/x', raw: false })).toBe('https://a.test/x');
    expect(argsSummary({ count: 3, label: ' hello ' })).toBe('hello');
    expect(argsSummary({ count: 3 })).toBeUndefined();
    expect(argsSummary(undefined)).toBeUndefined();
  });
});

describe('ToolCall', () => {
  it('shows the url of an MCP fetch in the header', () => {
    render(
      <ToolCall
        toolCall={part({ toolName: 'fetchv2__fetch', args: { url: 'https://a.test/page' } })}
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('fetchv2__fetch');
    expect(screen.getByRole('button')).toHaveTextContent('https://a.test/page');
  });

  it('shows the result count and provider for a web search', () => {
    render(
      <ToolCall
        toolCall={part({
          args: { query: 'q' },
          result: {
            provider: 'exa',
            results: [{ title: 'A', url: 'https://a.test', content: 'x' }],
          },
        })}
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('1 result · Exa');
  });
});
