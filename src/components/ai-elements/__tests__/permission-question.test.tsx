import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolApproval } from '../../../utils/kiroPermissions';
import { PermissionQuestion } from '../permission-question';

const options = [
  { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
  { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
];

const open = (overrides: Partial<ToolApproval> = {}): ToolApproval => ({
  requestId: '00000000-0000-4000-8000-00000000000a',
  state: 'open',
  options,
  ...overrides,
});

const renderQuestion = (approval: ToolApproval) =>
  render(<PermissionQuestion approval={approval} />);

describe('PermissionQuestion', () => {
  it('shows the command in a code element, with no backtick', () => {
    const { container } = renderQuestion(open({ title: 'ls', command: 'ls -la' }));
    expect(screen.getByText('Kiro wants to run')).toBeInTheDocument();
    const code = screen.getByText('ls -la');
    expect(code.tagName).toBe('CODE');
    expect(container.textContent).not.toContain('`');
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toBe('Kiro wants to run ls -la');
    expect(group.getAttribute('aria-label')).not.toContain('`');
  });

  it('shows a 300-character command in full, and the aria-label short', () => {
    const command = `echo ${'x'.repeat(295)}`;
    renderQuestion(open({ command }));
    expect(command).toHaveLength(300);
    expect(screen.getByText(command).tagName).toBe('CODE');
    const label = screen.getByRole('group').getAttribute('aria-label') ?? '';
    expect(label).toBe(`Kiro wants to run ${command.slice(0, 80)}…`);
  });

  it('keeps the line breaks of a multi-line command, and wraps and scrolls it', () => {
    const command = 'for f in a b; do\n  echo "$f"\ndone';
    renderQuestion(open({ command }));
    const code = screen.getByText((_, el) => el?.tagName === 'CODE' && el.textContent === command);
    expect(code.textContent).toBe(command);
    const block = code.parentElement!;
    expect(block.tagName).toBe('PRE');
    expect(block.className).toContain('whitespace-pre-wrap');
    expect(block.className).toContain('[overflow-wrap:anywhere]');
    expect(block.className).not.toContain('break-words');
    // It inherits the row's text size
    expect(block.className).not.toMatch(/text-\[|text-(xs|sm|base)/);
    expect(block.className).toContain('overflow-y-auto');
    expect(block.className).toMatch(/max-h-/);
    expect(block.className).toContain('bg-surface-quiet');
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      'Kiro wants to run for f in a b; do echo "$f" done'
    );
  });

  it('lets a keyboard user focus the scrolling command, and names it', () => {
    renderQuestion(open({ command: 'ls -la' }));
    const block = screen.getByLabelText('Command');
    expect(block.tagName).toBe('PRE');
    expect(block).toHaveAttribute('tabindex', '0');
    expect(block.className).toContain('focus-visible:outline-2');
    block.focus();
    expect(block).toHaveFocus();
  });

  it('does not show the trailing line breaks of a command', () => {
    const { container } = renderQuestion(open({ command: 'ls -la\n\n' }));
    expect(container.querySelector('code')?.textContent).toBe('ls -la');
  });

  it('says in words that a cut command is only the start', () => {
    renderQuestion(open({ command: 'x'.repeat(2000), commandCut: true }));
    expect(
      screen.getByText('The command is longer than 2,000 characters. Only the start shows.')
    ).toBeInTheDocument();
  });

  it('says nothing about a cut when the command is whole', () => {
    renderQuestion(open({ command: 'ls -la' }));
    expect(screen.queryByText(/longer than 2,000/)).toBeNull();
  });

  it.each([
    [{ review: true, title: 'Review changes' }, 'Kiro wants you to review the changes'],
    [{ title: 'Write File', resource: 'notes.txt' }, 'Kiro wants to use Write File · notes.txt'],
    [{ title: 'Write File' }, 'Kiro wants to use Write File'],
    [{}, 'Waiting for your answer'],
  ] as const)('reads well for a question without a command: %j', (extra, text) => {
    const { container } = renderQuestion(open(extra));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('code')).toBeNull();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(text);
    expect(within(screen.getByRole('group')).getAllByRole('button')).toHaveLength(2);
  });
});
