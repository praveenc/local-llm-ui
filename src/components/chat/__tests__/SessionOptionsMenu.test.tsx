import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SessionOption } from '../../../utils/sessionOptions';
import { SessionOptionsMenu } from '../SessionOptionsMenu';

const options: SessionOption[] = [
  {
    id: 'autopilot',
    name: 'Autopilot',
    currentValue: 'on',
    values: [
      { value: 'on', name: 'Autopilot', description: 'Runs tools without asking' },
      { value: 'off', name: 'Supervised', description: 'Asks before file changes' },
    ],
  },
  {
    id: 'memory',
    name: 'Memory reflection',
    description: 'Lets the session reflect on new memory',
    currentValue: 'off',
    values: [
      { value: 'on', name: 'On' },
      { value: 'off', name: 'Off' },
    ],
  },
];

describe('SessionOptionsMenu', () => {
  it('says the current value of each option in words', () => {
    render(<SessionOptionsMenu options={options} onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', {
        name: 'Session options: Autopilot: Autopilot · Memory reflection: Off',
      })
    ).toBeInTheDocument();
  });

  it("shows each option as a labelled group with the harness's names and descriptions", async () => {
    const user = userEvent.setup();
    render(<SessionOptionsMenu options={options} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Session options/ }));

    expect(screen.getByRole('group', { name: 'Autopilot' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Memory reflection' })).toBeInTheDocument();
    expect(screen.getByText('Lets the session reflect on new memory')).toBeInTheDocument();
    expect(screen.getByText('Asks before file changes')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Runs tools/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Supervised/ })).not.toBeChecked();
    // The current value also says so in words
    expect(screen.getByRole('menuitemradio', { name: /Runs tools/ })).toHaveTextContent('Current');
    expect(screen.getByRole('menuitemradio', { name: /Supervised/ })).not.toHaveTextContent(
      'Current'
    );
  });

  it('returns the option and the value that the user picks', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SessionOptionsMenu options={options} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Session options/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Supervised/ }));
    expect(onChange).toHaveBeenCalledWith('autopilot', 'off');
  });

  it('opens from the keyboard and cannot be opened while disabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionOptionsMenu options={options} onChange={vi.fn()} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    rerender(<SessionOptionsMenu options={options} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /Session options/ })).toBeDisabled();
  });
});
