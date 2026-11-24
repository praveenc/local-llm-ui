import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppLayout } from '../AppLayout';

const renderLayout = (extra: Partial<React.ComponentProps<typeof AppLayout>> = {}) =>
  render(
    <AppLayout
      {...extra}
      navigation={<div>nav</div>}
      visualMode="light"
      theme="light"
      onToggleTheme={vi.fn()}
      colorTheme="cobaltz"
      onColorThemeChange={vi.fn()}
      onVisualModeChange={vi.fn()}
    >
      <div>content</div>
    </AppLayout>
  );

describe('AppLayout', () => {
  it('shows one h1 with the conversation title', () => {
    const { rerender } = renderLayout();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New conversation');

    rerender(
      <AppLayout
        navigation={<div>nav</div>}
        title="Trip plan"
        visualMode="light"
        theme="light"
        onToggleTheme={vi.fn()}
        colorTheme="cobaltz"
        onColorThemeChange={vi.fn()}
        onVisualModeChange={vi.fn()}
      >
        <div>content</div>
      </AppLayout>
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trip plan');
  });

  it('shows no generic subtitle under the product name', () => {
    renderLayout();
    expect(screen.queryByText('Chat Interface')).not.toBeInTheDocument();
  });

  it('names the sidebar toggles', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument();
  });

  it('opens a named phone sheet with one close button', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(sheet).getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});

describe('AppLayout rename in the header', () => {
  const renderRenamable = (onRenameTitle = vi.fn()) => {
    renderLayout({ title: 'Trip plan', onRenameTitle });
    return onRenameTitle;
  };

  it('shows no pencil and no edit field without onRenameTitle', async () => {
    const user = userEvent.setup();
    renderLayout({ title: 'Trip plan' });
    expect(screen.queryByRole('button', { name: 'Rename chat' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
  });

  it('names the pencil button "Rename chat" and keeps the plain title in the h1', () => {
    renderRenamable();
    expect(screen.getByRole('button', { name: 'Rename chat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Trip plan$/);
  });

  it('starts editing with the title selected when the title is clicked', async () => {
    const user = userEvent.setup();
    renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    const input = screen.getByRole('textbox', { name: 'Chat title' }) as HTMLInputElement;
    expect(input).toHaveValue('Trip plan');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Trip plan'.length);
  });

  it('starts editing from the pencil button with the keyboard', async () => {
    const user = userEvent.setup();
    renderRenamable();
    screen.getByRole('button', { name: 'Rename chat' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Chat title' })).toBeInTheDocument();
  });

  it('saves the trimmed text on Enter and returns focus to the pencil', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.keyboard('  Summer   trip  {Enter}');
    expect(onRenameTitle).toHaveBeenCalledTimes(1);
    expect(onRenameTitle).toHaveBeenCalledWith('Summer trip');
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename chat' })).toHaveFocus();
  });

  it('saves on blur once and leaves the focus where the user clicked', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.keyboard('Summer trip');
    await user.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(onRenameTitle).toHaveBeenCalledTimes(1);
    expect(onRenameTitle).toHaveBeenCalledWith('Summer trip');
    expect(screen.getByRole('button', { name: 'Rename chat' })).not.toHaveFocus();
  });

  it('cancels on Esc without saving and returns focus to the pencil', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.keyboard('Something else{Escape}');
    expect(onRenameTitle).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trip plan');
    expect(screen.getByRole('button', { name: 'Rename chat' })).toHaveFocus();
  });

  it('does not save an empty title', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.keyboard('{Backspace}   {Enter}');
    expect(onRenameTitle).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trip plan');
  });

  it('does not write a title that did not change', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.keyboard('{Enter}');
    expect(onRenameTitle).not.toHaveBeenCalled();
  });

  it('ignores Enter that confirms an IME candidate', async () => {
    const user = userEvent.setup();
    const onRenameTitle = renderRenamable();
    await user.click(screen.getByRole('heading', { level: 1 }));
    const input = screen.getByRole('textbox', { name: 'Chat title' });
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    );
    const safari = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(safari, 'keyCode', { value: 229 });
    input.dispatchEvent(safari);
    expect(onRenameTitle).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('drops an open edit when the conversation goes away', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AppLayout
        navigation={<div>nav</div>}
        title="Trip plan"
        onRenameTitle={vi.fn()}
        visualMode="light"
        theme="light"
        onToggleTheme={vi.fn()}
        colorTheme="cobaltz"
        onColorThemeChange={vi.fn()}
        onVisualModeChange={vi.fn()}
      >
        <div>content</div>
      </AppLayout>
    );
    await user.click(screen.getByRole('heading', { level: 1 }));
    rerender(
      <AppLayout
        navigation={<div>nav</div>}
        visualMode="light"
        theme="light"
        onToggleTheme={vi.fn()}
        colorTheme="cobaltz"
        onColorThemeChange={vi.fn()}
        onVisualModeChange={vi.fn()}
      >
        <div>content</div>
      </AppLayout>
    );
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename chat' })).not.toBeInTheDocument();
  });
});
