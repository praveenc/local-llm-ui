import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ToolCallPart } from '../../../types/ai-messages';
import { argsSummary } from '../../../utils/toolCallSummary';
import { ToolCall } from '../tool-call';
import { WorkRow } from '../work-row';

const part = (overrides: Partial<ToolCallPart>): ToolCallPart => ({
  type: 'tool-call',
  toolCallId: 't1',
  toolName: 'webSearch',
  args: {},
  status: 'complete',
  ...overrides,
});

const searchResult = {
  provider: 'exa',
  results: [
    { title: 'A', url: 'https://www.a.test/x', content: 'x' },
    { title: 'B', url: 'https://b.test/y', content: 'y' },
  ],
};

describe('argsSummary', () => {
  it('prefers the query, then a url or path, then any string', () => {
    expect(argsSummary({ query: 'knowledge graphs', timeRange: 'year' })).toBe('knowledge graphs');
    expect(argsSummary({ url: 'https://a.test/x', raw: false })).toBe('https://a.test/x');
    expect(argsSummary({ count: 3, label: ' hello ' })).toBe('hello');
    expect(argsSummary({ count: 3 })).toBeUndefined();
    expect(argsSummary(undefined)).toBeUndefined();
  });
});

const renderStep = (toolCall: ToolCallPart) =>
  render(
    <ol>
      <ToolCall toolCall={toolCall} />
    </ol>
  );

describe('ToolCall', () => {
  it('shows the short name and the url of an MCP fetch, with the full name as a tooltip', () => {
    renderStep(part({ toolName: 'fetchv2__fetch', args: { url: 'https://a.test/page' } }));
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('fetch');
    expect(button).toHaveTextContent('https://a.test/page');
    expect(button).toHaveAttribute('title', 'fetchv2__fetch');
  });

  it('shows the result count, the provider, and the result sites of a web search', () => {
    renderStep(part({ args: { query: 'q' }, result: searchResult }));
    expect(screen.getByRole('button')).toHaveTextContent('2 results · Exa');
    expect(screen.getByText('a.test · b.test')).toBeInTheDocument();
  });

  it('says Running for an MCP tool and Searching for a search while they wait', () => {
    const { unmount } = renderStep(part({ toolName: 'fetch', status: 'pending' }));
    expect(screen.getByRole('button')).toHaveTextContent('Running…');
    unmount();
    renderStep(part({ status: 'pending' }));
    expect(screen.getByRole('button')).toHaveTextContent('Searching…');
  });

  it('shows a failed tool and its error when opened', async () => {
    const user = userEvent.setup();
    renderStep(part({ toolName: 'fetch', status: 'error', result: 'Connection refused' }));
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Failed');
    await user.click(button);
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('shows the text of an MCP result, not its JSON', async () => {
    const user = userEvent.setup();
    renderStep(
      part({ toolName: 'fetch', result: { content: [{ type: 'text', text: 'Page text' }] } })
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Page text')).toBeInTheDocument();
  });
});

describe('WorkRow', () => {
  it('summarises the work of a finished reply in one line, collapsed', () => {
    render(
      <WorkRow
        reasoning="plan"
        reasoningMs={4200}
        toolCalls={[part({ args: { query: 'q' }, result: searchResult })]}
        isRunning={false}
        hasText
      />
    );
    const trigger = screen.getByRole('button', { name: /Thought 4 s · 1 search · 2 sources/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('plan')).not.toBeInTheDocument();
  });

  it('shows the step that runs now while the reply streams', () => {
    render(
      <WorkRow
        toolCalls={[part({ args: { query: 'riemann zeros' }, status: 'pending' })]}
        isRunning
        hasText={false}
      />
    );
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Searching “riemann zeros”');
  });

  it('lists the thinking and each tool call when opened', async () => {
    const user = userEvent.setup();
    render(
      <WorkRow
        reasoning="First I search."
        toolCalls={[
          part({ toolCallId: 'a', args: { query: 'q' }, result: searchResult }),
          part({ toolCallId: 'b', toolName: 'fetch', status: 'error', result: 'boom' }),
        ]}
        isRunning={false}
        hasText
      />
    );
    const trigger = screen.getByRole('button', {
      name: /1 search · 2 sources · 1 fetch call · 1 failed/,
    });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(steps).toHaveTextContent('Thought');
    expect(steps).toHaveTextContent('First I search.');
    expect(steps).toHaveTextContent('Web search');
    expect(steps).toHaveTextContent('Failed');
  });
});

describe('ToolCall with Kiro approvals', () => {
  const kiroPart = (overrides: Partial<ToolCallPart>) =>
    part({ toolName: 'shell', args: { command: 'echo bye' }, ...overrides });

  it('says "Denied", not "Failed", for a tool that the user denied', () => {
    renderStep(
      kiroPart({
        status: 'error',
        result: 'The user rejected this tool call',
        approvals: [{ requestId: 'r1', state: 'answered', kind: 'reject_once' }],
      })
    );
    const line = screen.getByRole('button');
    expect(line).toHaveTextContent('Denied');
    expect(line).not.toHaveTextContent('Failed');
  });

  it('says "Failed" for a real error after an allowed question', () => {
    renderStep(
      kiroPart({
        status: 'error',
        result: 'Command exited with status 1',
        approvals: [{ requestId: 'r1', state: 'answered', kind: 'allow_once' }],
      })
    );
    expect(screen.getByRole('button')).toHaveTextContent('Allowed · Failed');
  });

  it('ends a pending tool whose question was not answered', () => {
    renderStep(
      kiroPart({ status: 'pending', approvals: [{ requestId: 'r1', state: 'not-answered' }] })
    );
    const line = screen.getByRole('button');
    expect(line).toHaveTextContent('Not answered');
    expect(line).not.toHaveTextContent('Running…');
    expect(line).toBeEnabled();
  });

  it('says "Waiting for your answer" while a question is open', () => {
    renderStep(
      kiroPart({
        status: 'pending',
        approvals: [
          {
            requestId: '00000000-0000-4000-8000-00000000000a',
            state: 'open',
            title: 'Review changes',
            review: true,
            options: [
              { optionId: 'a', name: 'Accept changes', kind: 'allow_once' },
              { optionId: 'r', name: 'Reject changes', kind: 'reject_once' },
            ],
          },
        ],
      })
    );
    expect(screen.getByRole('button', { name: /shell/ })).toHaveTextContent(
      'Waiting for your answer'
    );
    expect(screen.getByText('Kiro wants you to review the changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept changes' })).toBeEnabled();
  });
});
