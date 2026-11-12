import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThinkingEffortSelector } from '../ThinkingEffortSelector';

describe('ThinkingEffortSelector', () => {
  it('shows the current effort on the pill', () => {
    render(<ThinkingEffortSelector value="xhigh" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Thinking: XHigh/ })).toBeInTheDocument();
  });

  it('lists every effort and returns the one picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThinkingEffortSelector value="default" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Thinking: Default/ }));
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(items).toEqual(['Default', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'XHigh']);
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeChecked();

    await user.click(screen.getByRole('menuitemradio', { name: 'Medium' }));
    expect(onChange).toHaveBeenCalledWith('medium');
  });

  it('lists only the efforts that it is given', async () => {
    const user = userEvent.setup();
    render(
      <ThinkingEffortSelector
        value="default"
        onChange={vi.fn()}
        options={[
          { value: 'default', label: 'Default' },
          { value: 'high', label: 'High' },
        ]}
      />
    );
    await user.click(screen.getByRole('button', { name: /Thinking: Default/ }));
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(items).toEqual(['Default', 'High']);
  });

  it('cannot be opened while disabled', () => {
    render(<ThinkingEffortSelector value="low" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /Thinking: Low/ })).toBeDisabled();
  });
});
