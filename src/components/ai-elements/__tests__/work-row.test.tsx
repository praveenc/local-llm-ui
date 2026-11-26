import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../../../db/types';
import type { ToolCallPart } from '../../../types/ai-messages';
import { toUIMessage } from '../../../types/ai-messages';
import type { ToolApproval } from '../../../utils/kiroPermissions';
import { toStoredToolCall } from '../../../utils/toolResults';
import { WorkRow } from '../work-row';

const REQUEST = '00000000-0000-4000-8000-00000000000a';

const shellOptions = [
  { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
  { optionId: 'reject_always', name: 'Always deny', kind: 'reject_always' },
];

const openShell: ToolApproval = {
  requestId: REQUEST,
  state: 'open',
  title: 'echo hi > hello.txt',
  command: 'echo hi > hello.txt',
  options: shellOptions,
};

const shell = (overrides: Partial<ToolCallPart> = {}): ToolCallPart => ({
  type: 'tool-call',
  toolCallId: 't1',
  toolName: 'run_command',
  args: { command: 'echo hi > hello.txt' },
  status: 'pending',
  ...overrides,
});

const renderRow = (toolCalls: ToolCallPart[], isRunning = true) =>
  render(<WorkRow toolCalls={toolCalls} isRunning={isRunning} hasText={false} provider="kiro" />);

const stubFetch = (response: { ok: boolean; status: number; body?: unknown } | Promise<never>) => {
  const fetchMock = vi.fn(() =>
    response instanceof Promise
      ? response
      : Promise.resolve({
          ok: response.ok,
          status: response.status,
          json: () => Promise.resolve(response.body ?? {}),
        })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** A reply as it comes back from the database after a reload */
const reloaded = (part: ToolCallPart): ToolCallPart => {
  const message = toUIMessage({
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'done',
    sequence: 2,
    createdAt: new Date(),
    provider: 'kiro',
    modelId: 'claude-haiku-5.5',
    modelName: 'Claude Haiku 5.5',
    toolCalls: [toStoredToolCall(part)],
  } satisfies Message);
  return message.parts.find((p): p is ToolCallPart => p.type === 'tool-call')!;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkRow with a Kiro question', () => {
  it('opens by itself, says "Waiting for your answer" on its line, and shows the question once', () => {
    renderRow([shell({ approvals: [openShell] })]);
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(steps).toBeVisible();
    // The row's line says only that Kiro waits; the question with the command shows once
    // (the tool's own line shows the command as its argument, in a span, not as the question)
    expect(document.querySelectorAll('code')).toHaveLength(1);
    expect(screen.getAllByText('Kiro wants to run')).toHaveLength(1);
    expect(document.querySelector('code')).toHaveTextContent('echo hi > hello.txt');
    // The summary line (the row's trigger) says exactly this, with no command
    const summaryLine = screen.getByRole('button', { name: 'Waiting for your answer' });
    expect(summaryLine).toHaveAttribute('data-running');
    expect(summaryLine.textContent).toBe('Waiting for your answer');
    expect(within(steps).getByText('Waiting for your answer')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('`');
  });

  it("shows Kiro's options as buttons in Kiro's order, outside the tool line's button", () => {
    renderRow([shell({ approvals: [openShell] })]);
    const group = screen.getByRole('group', { name: 'Kiro wants to run echo hi > hello.txt' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Allow',
      'Always allow',
      'Deny',
      'Always deny',
    ]);
    for (const button of buttons) {
      expect(button.closest('button')).toBe(button);
      expect(button.parentElement?.closest('button')).toBeNull();
      expect(button.className).toContain('min-h-11');
    }
  });

  it('posts the clicked option and keeps the buttons off while it waits', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { answered: true } });
    renderRow([shell({ approvals: [openShell] })]);
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: REQUEST, optionId: 'reject_once' }),
    });
    for (const name of ['Allow', 'Always allow', 'Deny', 'Always deny']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(await screen.findByText('Answer sent. Waiting for Kiro…')).toBeInTheDocument();
  });

  it('answers with the keyboard', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    renderRow([shell({ approvals: [openShell] })]);
    screen.getByRole('button', { name: 'Allow' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    ).toEqual({ requestId: REQUEST, optionId: 'allow_once' });
  });

  it('says an error in words and lets the user try again', async () => {
    stubFetch({ ok: false, status: 404, body: { error: 'Not found' } });
    renderRow([shell({ approvals: [openShell] })]);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your answer was not sent: This question has ended'
    );
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('says the answer in words after the question ends', () => {
    const { rerender } = renderRow([shell({ approvals: [openShell] })]);
    rerender(
      <WorkRow
        toolCalls={[
          shell({
            status: 'complete',
            result: '',
            approvals: [{ requestId: REQUEST, state: 'answered', kind: 'allow_once' }],
          }),
        ]}
        isRunning
        hasText={false}
        provider="kiro"
      />
    );
    expect(screen.queryByRole('group')).toBeNull();
    // The row stays open after the question, so the answer shows
    expect(screen.getByText('Allowed')).toBeVisible();
  });
});

describe('WorkRow after a Kiro question', () => {
  const denied = shell({
    status: 'error',
    result: 'The user rejected this tool call',
    approvals: [{ requestId: REQUEST, state: 'answered', kind: 'reject_once' }],
  });

  it('says "1 denied" in the summary, not in red, and "Denied" on the line', async () => {
    renderRow([denied], false);
    const summary = screen.getByText('1 denied');
    expect(summary.className).not.toContain('destructive');
    expect(screen.queryByText(/failed/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /1 run command call/ }));
    expect(screen.getByText('Denied')).toBeVisible();
  });

  it('shows the same words after a reload', async () => {
    const parts = [
      reloaded(denied),
      reloaded(shell({ toolCallId: 't2', approvals: [openShell] })),
      reloaded(
        shell({
          toolCallId: 't3',
          toolName: 'write',
          status: 'complete',
          approvals: [
            { requestId: 'r1', state: 'answered', kind: 'allow_always' },
            { requestId: 'r2', state: 'answered', kind: 'reject_once', review: true },
          ],
        })
      ),
    ];
    expect(parts[1].approvals).toEqual([{ requestId: REQUEST, state: 'not-answered' }]);
    renderRow(parts, false);
    expect(screen.getByRole('button', { name: /denied/ })).toHaveTextContent(
      '2 run command calls · 1 write call · 2 denied · 1 not answered'
    );
    await userEvent.click(screen.getByRole('button', { name: /denied/ }));
    expect(screen.getByText('Denied')).toBeVisible();
    expect(screen.getByText('Not answered')).toBeVisible();
    expect(screen.getByText('Always allowed · Changes rejected')).toBeVisible();
    expect(screen.queryByRole('group')).toBeNull();
  });
});
