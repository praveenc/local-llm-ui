import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '../dialog';

// A dialog opened from state, with no DialogTrigger, like Preferences and Saved Prompts
const Harness = ({ removeOpener = false }: { removeOpener?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  return (
    <>
      <button type="button">Before</button>
      {showOpener && (
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && removeOpener) setShowOpener(false);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Settings</DialogTitle>
          <button type="button">Inside</button>
        </DialogContent>
      </Dialog>
    </>
  );
};

describe('DialogContent focus return', () => {
  it('returns focus to the element that opened a dialog without a trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('leaves focus alone when the opener is gone', async () => {
    const user = userEvent.setup();
    render(<Harness removeOpener />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
