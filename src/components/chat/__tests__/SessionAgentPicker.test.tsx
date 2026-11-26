import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SessionOption } from '../../../utils/sessionOptions';
import { SessionAgentPicker } from '../SessionAgentPicker';

const mode: SessionOption = {
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  currentValue: 'agent-a',
  values: [
    { value: 'agent-a', name: 'Agent A', description: 'The default agent' },
    { value: 'agent-b', name: 'Agent B', description: 'Reviews code' },
    { value: 'agent-c', name: 'Agent C' },
  ],
};

describe('SessionAgentPicker', () => {
  it("shows the harness's name of the current agent in words", () => {
    render(<SessionAgentPicker option={mode} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Agent: Agent A' })).toBeInTheDocument();
  });

  it('lists every agent with its description and marks the current one', async () => {
    const user = userEvent.setup();
    render(<SessionAgentPicker option={mode} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));

    const items = screen.getAllByRole('option');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Current')).toBeInTheDocument();
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(within(items[1]).getByText('Reviews code')).toBeInTheDocument();
    expect(within(items[1]).queryByText('Current')).not.toBeInTheDocument();
  });

  it('filters by name and returns the picked value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SessionAgentPicker option={mode} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));
    await user.type(screen.getByPlaceholderText('Search agents'), 'reviews');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('agent-b');
  });

  it('does not report the current agent again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SessionAgentPicker option={mode} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));
    await user.click(screen.getByRole('option', { name: /Agent A/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    render(<SessionAgentPicker option={mode} onChange={vi.fn()} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Agent: Agent A' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByPlaceholderText('Search agents')).toBeInTheDocument();
  });

  it('calls onOpen each time the list opens, not when it closes', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<SessionAgentPicker option={mode} onChange={vi.fn()} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('Search agents')).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('takes a new list while open, without closing or moving the focus (D26)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionAgentPicker option={mode} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Agent: Agent A' }));
    const search = screen.getByPlaceholderText('Search agents');
    await user.type(search, 'agent');
    expect(search).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(3);

    const refreshed: SessionOption = {
      ...mode,
      values: [...mode.values, { value: 'agent-new', name: 'Agent New', description: 'Made now' }],
    };
    rerender(<SessionAgentPicker option={refreshed} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search agents')).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue('agent');
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('option', { name: /Agent New/ })).toBeInTheDocument();
  });

  it('cannot be opened while disabled', () => {
    render(<SessionAgentPicker option={mode} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Agent: Agent A' })).toBeDisabled();
  });
});
