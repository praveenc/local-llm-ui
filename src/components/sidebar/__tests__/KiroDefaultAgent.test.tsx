import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kiroService } from '../../../services/kiro';
import { KiroDefaultAgent } from '../KiroDefaultAgent';

const mode = {
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  currentValue: 'agent-a',
  values: [
    { value: 'agent-a', name: 'Agent A', description: 'The first agent' },
    { value: 'agent-b', name: 'Agent B', description: 'Reviews code' },
  ],
};

/** Kiro's lists reach the service through the models response, as in the app */
async function loadLists(sessionOptions: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ models: [], sessionOptions }),
    })
  );
  await kiroService.getModels();
}

describe('KiroDefaultAgent', () => {
  beforeEach(async () => {
    await loadLists({ mode, options: [] });
  });

  afterEach(async () => {
    await loadLists(undefined);
    vi.unstubAllGlobals();
  });

  it("shows Kiro's default first, then Kiro's agents with their descriptions", async () => {
    const user = userEvent.setup();
    render(<KiroDefaultAgent value={undefined} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Default agent|Kiro's default/ });
    expect(trigger).toHaveTextContent("Kiro's default");
    await user.click(trigger);

    const items = screen.getAllByRole('option');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Kiro's default")).toBeInTheDocument();
    expect(within(items[0]).getByText('Current')).toBeInTheDocument();
    expect(within(items[1]).getByText('Agent A')).toBeInTheDocument();
    expect(within(items[2]).getByText('Reviews code')).toBeInTheDocument();
  });

  it('names the stored agent and marks it as current', async () => {
    const user = userEvent.setup();
    render(<KiroDefaultAgent value="agent-b" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Agent B/ });
    await user.click(trigger);
    const items = screen.getAllByRole('option');
    expect(within(items[2]).getByText('Current')).toBeInTheDocument();
    expect(within(items[0]).queryByText('Current')).not.toBeInTheDocument();
  });

  it('a pick gives the agent id, and the first entry gives undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<KiroDefaultAgent value={undefined} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Kiro's default/ }));
    await user.click(screen.getByRole('option', { name: /Agent B/ }));
    expect(onChange).toHaveBeenCalledWith('agent-b');

    onChange.mockClear();
    rerender(<KiroDefaultAgent value="agent-b" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Agent B/ }));
    await user.click(screen.getByRole('option', { name: /Kiro's default/ }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('picking the agent that is stored changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KiroDefaultAgent value="agent-a" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Agent A/ }));
    await user.click(screen.getByRole('option', { name: /Agent A/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says that an agent is not in Kiro's list any more, and shows Kiro's default", () => {
    render(<KiroDefaultAgent value="agent-gone" onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent("This agent is no longer in Kiro's list.");
    expect(screen.getByRole('button', { name: /Kiro's default/ })).toBeInTheDocument();
  });

  it('says nothing about a listed agent, and has the rule text as help', () => {
    render(<KiroDefaultAgent value="agent-a" onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agent A/ })).toHaveAccessibleDescription(
      /When you pick an agent, you accept its rules\./
    );
  });

  it('keeps the stored id and no note while the list has not loaded', async () => {
    await loadLists(undefined);
    render(<KiroDefaultAgent value="agent-a" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /agent-a/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("opening the list asks for Kiro's agents again (D26, throttled by the service)", async () => {
    const user = userEvent.setup();
    const refresh = vi
      .spyOn(kiroService, 'refreshDefaultSessionOptions')
      .mockResolvedValue(undefined);
    render(<KiroDefaultAgent value={undefined} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Default agent|Kiro's default/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });
});
