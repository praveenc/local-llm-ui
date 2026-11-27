import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroFolderSetting as FolderSetting } from '../../../utils/kiroSettings';
import { KiroFolderSetting } from '../KiroFolderSetting';

const mocks = vi.hoisted(() => ({
  folder: undefined as { path: string; isDefault: boolean } | undefined,
  setFolder: vi.fn(),
  setWorkspaceDir: vi.fn(),
}));

vi.mock('../../../hooks/useKiroStatus', () => ({
  useKiroStatus: () => ({
    status: { state: 'signed-in', folder: mocks.folder },
    setFolder: mocks.setFolder,
  }),
}));
vi.mock('../../../services/kiro', () => ({
  kiroService: { setWorkspaceDir: mocks.setWorkspaceDir },
}));

const DEFAULT: FolderSetting = { path: '~/.local-llm-ui/kiro', isDefault: true };
const WORK: FolderSetting = { path: '~/work', isDefault: false };

const field = () => screen.getByRole('textbox', { name: 'Folder for new Kiro chats' });

describe('KiroFolderSetting', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.folder = DEFAULT;
    mocks.setFolder.mockReset();
    mocks.setWorkspaceDir.mockReset();
    mocks.setWorkspaceDir.mockImplementation(async (value: string | null) =>
      value === null ? DEFAULT : { path: value, isDefault: false }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const typeInto = async (text: string) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.clear(field());
    await user.type(field(), text);
    return user;
  };

  it('shows the stored folder and the help text', () => {
    render(<KiroFolderSetting />);
    expect(field()).toHaveValue('~/.local-llm-ui/kiro');
    expect(field()).toHaveAccessibleDescription(
      "Kiro's tools read files and run commands in this folder. Kiro asks before it runs a command or writes a file."
    );
  });

  it('saves 700 ms after typing stops, with one request', async () => {
    render(<KiroFolderSetting />);
    await typeInto('~/work');
    expect(mocks.setWorkspaceDir).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(mocks.setWorkspaceDir).toHaveBeenCalledTimes(1);
    expect(mocks.setWorkspaceDir).toHaveBeenCalledWith('~/work');
    expect(mocks.setFolder).toHaveBeenCalledWith(WORK);
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('calls onSaved when a save ends with Saved, and not when it fails (S12)', async () => {
    const onSaved = vi.fn();
    render(<KiroFolderSetting onSaved={onSaved} />);
    const user = await typeInto('~/work');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(onSaved).toHaveBeenCalledTimes(1);

    mocks.setWorkspaceDir.mockRejectedValue(new Error('This folder does not exist.'));
    await user.clear(field());
    await user.type(field(), '~/missing');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved.');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not call onSaved for a stale save', async () => {
    let finish: (value: FolderSetting) => void = () => undefined;
    mocks.setWorkspaceDir.mockImplementationOnce(
      () => new Promise<FolderSetting>((resolve) => (finish = resolve))
    );
    const onSaved = vi.fn();
    render(<KiroFolderSetting onSaved={onSaved} />);
    const user = await typeInto('~/one');
    await user.keyboard('{Enter}');
    // Typing again makes the running save stale
    await user.type(field(), 'x');
    await act(async () => finish({ path: '~/one', isDefault: false }));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onSaved without an error when the save ends after the row closed', async () => {
    let finish: (value: FolderSetting) => void = () => undefined;
    mocks.setWorkspaceDir.mockImplementationOnce(
      () => new Promise<FolderSetting>((resolve) => (finish = resolve))
    );
    const onSaved = vi.fn();
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { unmount } = render(<KiroFolderSetting onSaved={onSaved} />);
    await typeInto('~/later');
    // Closed while the value waits for its delay: the unmount saves it
    unmount();
    expect(mocks.setWorkspaceDir).toHaveBeenCalledWith('~/later');
    await act(async () => finish({ path: '~/later', isDefault: false }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it('saves on Enter and on blur without waiting', async () => {
    render(<KiroFolderSetting />);
    const user = await typeInto('~/one');
    await user.keyboard('{Enter}');
    expect(mocks.setWorkspaceDir).toHaveBeenLastCalledWith('~/one');

    await user.clear(field());
    await user.type(field(), '~/two');
    await user.tab();
    expect(mocks.setWorkspaceDir).toHaveBeenLastCalledWith('~/two');
    expect(mocks.setWorkspaceDir).toHaveBeenCalledTimes(2);
  });

  it('shows a system folder as not saved, in words, and sends nothing', async () => {
    render(<KiroFolderSetting />);
    const user = await typeInto('/etc');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved. Kiro cannot use a system folder.'
    );
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.setWorkspaceDir).not.toHaveBeenCalled();
    expect(mocks.setFolder).not.toHaveBeenCalled();
  });

  it('shows the message of the server when it refuses a folder', async () => {
    mocks.setWorkspaceDir.mockRejectedValue(new Error('This folder does not exist.'));
    render(<KiroFolderSetting />);
    const user = await typeInto('~/missing');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved. This folder does not exist.'
    );
    expect(mocks.setFolder).not.toHaveBeenCalled();
  });

  it('sends nothing when the text did not change', async () => {
    render(<KiroFolderSetting />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(field());
    await user.type(field(), 'x');
    await user.type(field(), '{Backspace}');
    await user.tab();
    expect(mocks.setWorkspaceDir).not.toHaveBeenCalled();
  });

  it('Use the default sends null at once, and is off while the default is in use', async () => {
    const { unmount } = render(<KiroFolderSetting />);
    expect(screen.getByRole('button', { name: 'Use the default' })).toBeDisabled();
    unmount();

    mocks.folder = WORK;
    render(<KiroFolderSetting />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Use the default' }));
    expect(mocks.setWorkspaceDir).toHaveBeenCalledWith(null);
    expect(mocks.setFolder).toHaveBeenCalledWith(DEFAULT);
  });

  it('saves a typed value that waits for its delay when Preferences closes', async () => {
    const { unmount } = render(<KiroFolderSetting />);
    await typeInto('~/late');
    expect(mocks.setWorkspaceDir).not.toHaveBeenCalled();
    unmount();
    expect(mocks.setWorkspaceDir).toHaveBeenCalledWith('~/late');
  });
});
