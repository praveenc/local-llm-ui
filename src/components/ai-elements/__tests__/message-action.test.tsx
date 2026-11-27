import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageAction, MessageActions } from '../message';

// Count the providers that render. `Tooltip` has its own provider, so a wrapper in
// `MessageAction` would add one more for every action.
const providerRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/ui/tooltip', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/ui/tooltip')>();
  return {
    ...original,
    TooltipProvider: (props: React.ComponentProps<typeof original.TooltipProvider>) => {
      providerRenders.count += 1;
      return original.TooltipProvider(props);
    },
  };
});

describe('MessageAction', () => {
  beforeEach(() => {
    providerRenders.count = 0;
  });

  it('adds no tooltip provider of its own', () => {
    render(
      <MessageActions>
        <MessageAction tooltip="Copy">c</MessageAction>
        <MessageAction tooltip="Regenerate">r</MessageAction>
        <MessageAction tooltip="Good">g</MessageAction>
        <MessageAction tooltip="Bad">b</MessageAction>
      </MessageActions>
    );
    // `Tooltip` renders its own provider from inside ui/tooltip.tsx, which this mock does not
    // see. Before the change, `MessageAction` rendered the mocked provider once per action.
    expect(providerRenders.count).toBe(0);
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('renders no provider for an action with no tooltip', () => {
    render(<MessageAction label="Copy" />);
    expect(providerRenders.count).toBe(0);
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
  });

  it('still shows the tooltip on hover', async () => {
    const user = userEvent.setup();
    render(
      <MessageActions>
        <MessageAction tooltip="Copy">c</MessageAction>
      </MessageActions>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy');
  });

  it('still shows the tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <MessageActions>
        <MessageAction tooltip="Regenerate">r</MessageAction>
      </MessageActions>
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /Regenerate/ })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Regenerate');
  });
});
