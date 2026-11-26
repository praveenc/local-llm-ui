import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { KiroSessionsChoice } from '../KiroSessionsChoice';

describe('KiroSessionsChoice', () => {
  it('shows nothing while Kiro is signed out', () => {
    const { container } = render(
      <KiroSessionsChoice signedIn={false} value={undefined} onChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('asks first, and Show turns the section on', async () => {
    const onChange = vi.fn();
    render(<KiroSessionsChoice signedIn value={undefined} onChange={onChange} />);
    expect(
      screen.getByRole('group', { name: 'Show your Kiro sessions in the sidebar?' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Not now keeps the section off', async () => {
    const onChange = vi.fn();
    render(<KiroSessionsChoice signedIn value={undefined} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('after the answer, a switch keeps the choice', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<KiroSessionsChoice signedIn value={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Show Kiro sessions in the sidebar' });
    expect(toggle).toHaveAccessibleDescription(
      "The sessions come from Kiro. Delete in the app keeps Kiro's files."
    );
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<KiroSessionsChoice signedIn value onChange={onChange} />);
    expect(screen.getByRole('switch', { name: /Show Kiro sessions/ })).toBeChecked();
  });
});
