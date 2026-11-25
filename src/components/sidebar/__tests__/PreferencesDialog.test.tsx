import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroSignInOptions, KiroSignInPhase } from '../../../hooks/useKiroSignIn';
import type { KiroStatus } from '../../../utils/kiroStatus';
import { PreferencesDialog } from '../PreferencesDialog';

const kiro = vi.hoisted(() => ({
  status: undefined as KiroStatus | undefined,
  refresh: vi.fn(),
  isRefreshing: false,
}));
vi.mock('../../../hooks/useKiroStatus', () => ({
  useKiroStatus: () => kiro,
}));

const signIn = vi.hoisted(() => ({
  phase: 'idle' as KiroSignInPhase,
  code: undefined as string | undefined,
  url: undefined as string | undefined,
  message: undefined as string | undefined,
  start: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  signOut: vi.fn(),
  isSigningOut: false,
  signOutError: undefined as string | undefined,
  /** The callbacks that the dialog gave the hook in its last render */
  options: {} as KiroSignInOptions,
}));
vi.mock('../../../hooks/useKiroSignIn', () => ({
  useKiroSignIn: (options: KiroSignInOptions = {}) => {
    signIn.options = options;
    return signIn;
  },
}));

const STORAGE_KEY = 'local-llm-ui-preferences';

const resetSignIn = () => {
  signIn.phase = 'idle';
  signIn.code = undefined;
  signIn.url = undefined;
  signIn.message = undefined;
  signIn.isSigningOut = false;
  signIn.signOutError = undefined;
  signIn.start.mockReset();
  signIn.cancel.mockReset();
  signIn.reset.mockReset();
  signIn.signOut.mockReset();
};

const renderDialog = (stored: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  const ui = () => <PreferencesDialog open onOpenChange={onOpenChange} onChange={onSave} />;
  const result = render(ui());
  // A new element each time, so that React renders again
  return { onSave, onOpenChange, rerender: () => result.rerender(ui()) };
};

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

describe('PreferencesDialog providers', () => {
  beforeEach(() => {
    localStorage.clear();
    kiro.status = { state: 'not-installed' };
    kiro.refresh.mockReset();
    kiro.isRefreshing = false;
  });

  it('disables providers that have no API key', () => {
    renderDialog({ anthropicApiKey: 'sk-ant' });
    expect(screen.getByRole('radio', { name: /Groq/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /OpenRouter/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Amazon Bedrock/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Ollama/ })).toBeEnabled();
  });

  it('saves the chosen provider', () => {
    const { onSave } = renderDialog({ preferredProvider: 'anthropic', anthropicApiKey: 'sk-ant' });
    fireEvent.click(screen.getByRole('radio', { name: /Amazon Bedrock/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'bedrock' }));
    expect(stored().preferredProvider).toBe('bedrock');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('enables a provider once its key is added in its row', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    const groq = screen.getByRole('radio', { name: /Groq/ });
    expect(groq).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Groq\)/ }));
    fireEvent.change(screen.getByLabelText('Groq API key'), { target: { value: ' gsk_1 ' } });
    expect(groq).toBeEnabled();

    // Choosing the provider saves at once, with the key typed before it
    fireEvent.click(groq);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferredProvider: 'groq', groqApiKey: 'gsk_1' })
    );
  });

  it('shows the region field only for Bedrock Mantle', () => {
    renderDialog({});
    fireEvent.click(screen.getByRole('button', { name: /Add key \(Bedrock Mantle\)/ }));
    expect(screen.getByLabelText('Region')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add key \(Cerebras\)/ }));
    expect(screen.queryByLabelText('Region')).not.toBeInTheDocument();
  });

  it('does not save while the default provider has no API key', () => {
    const { onSave } = renderDialog({ preferredProvider: 'groq', groqApiKey: 'gsk_1' });
    fireEvent.click(screen.getByRole('button', { name: /Edit key \(Groq\)/ }));
    const key = screen.getByLabelText('Groq API key');
    fireEvent.change(key, { target: { value: '' } });
    fireEvent.blur(key);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Add an API key for Groq');
    expect(screen.getByRole('status')).toHaveTextContent('Not saved');

    // A provider that needs no key makes the change valid, and both parts save
    fireEvent.click(screen.getByRole('radio', { name: /Amazon Bedrock/ }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ preferredProvider: 'bedrock', groqApiKey: '' })
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves a typed key when you stop typing, and not on each letter', async () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('button', { name: /Add key \(Groq\)/ }));
    fireEvent.change(screen.getByLabelText('Groq API key'), { target: { value: 'gsk_2' } });
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ groqApiKey: 'gsk_2' }))
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows Default thinking only on the selected provider row', () => {
    renderDialog({ preferredProvider: 'bedrock' });
    expect(screen.getByLabelText('Default thinking (Amazon Bedrock)')).toHaveTextContent('Default');
    expect(screen.getAllByText('Default thinking')).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: /Ollama/ }));
    expect(screen.getByLabelText('Default thinking (Ollama)')).toBeInTheDocument();

    // LM Studio does not send a thinking effort, so it has no row
    fireEvent.click(screen.getByRole('radio', { name: /LM Studio/ }));
    expect(screen.queryByText('Default thinking')).not.toBeInTheDocument();
  });

  it('saves the default thinking effort for the provider', () => {
    const { onSave } = renderDialog({
      preferredProvider: 'bedrock',
      thinkingEffortByProvider: { anthropic: 'low' },
    });
    const trigger = screen.getByLabelText('Default thinking (Amazon Bedrock)');
    // jsdom lacks the pointer APIs that Radix Select uses, so open it with the keyboard
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'High' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingEffortByProvider: { anthropic: 'low', bedrock: 'high' },
      })
    );
  });
});

describe('PreferencesDialog Kiro', () => {
  beforeEach(() => {
    resetSignIn();
    localStorage.clear();
    kiro.status = { state: 'not-installed' };
    kiro.refresh.mockReset();
    kiro.isRefreshing = false;
  });

  it('has no Kiro row when kiro-cli is not installed or the status is not known', () => {
    renderDialog({});
    expect(screen.queryByRole('radio', { name: /Kiro/ })).not.toBeInTheDocument();
    cleanup();
    kiro.status = undefined;
    renderDialog({});
    expect(screen.queryByRole('radio', { name: /Kiro/ })).not.toBeInTheDocument();
  });

  it('shows a signed-in account and lets you choose Kiro as the default provider', () => {
    kiro.status = {
      state: 'signed-in',
      path: '~/.local/bin/kiro-cli',
      version: '3.5.0',
      account: { type: 'identity-center', email: 'dev@example.com' },
    };
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    const group = screen.getByRole('group', { name: 'AWS and local' });
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('id'));
    expect(names).toEqual([
      'provider-bedrock',
      'provider-kiro',
      'provider-lmstudio',
      'provider-ollama',
    ]);

    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(
      screen.getByText('dev@example.com · IAM Identity Center · Kiro CLI 3.5.0')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check again/ })).not.toBeInTheDocument();

    const radio = screen.getByRole('radio', { name: /Kiro/ });
    expect(radio).toBeEnabled();
    fireEvent.click(radio);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'kiro' }));
    expect(stored().preferredProvider).toBe('kiro');
    // Kiro's Default thinking row offers Max, and no Minimal (Kiro has no such level)
    const trigger = screen.getByLabelText('Default thinking (Kiro)');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Default',
      'Off',
      'Low',
      'Medium',
      'High',
      'XHigh',
      'Max',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Max' }));
    expect(stored().thinkingEffortByProvider).toEqual({ kiro: 'max' });
  });

  it('offers no Max on the Default thinking row of other providers', () => {
    renderDialog({ preferredProvider: 'bedrock' });
    const trigger = screen.getByLabelText('Default thinking (Amazon Bedrock)');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('option', { name: 'Max' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Minimal' })).toBeInTheDocument();
  });

  it('leaves out the email when the account has none', () => {
    kiro.status = {
      state: 'signed-in',
      path: '~/.local/bin/kiro-cli',
      version: '3.5.0',
      account: { type: 'api-key' },
    };
    renderDialog({});
    expect(screen.getByText('API key · Kiro CLI 3.5.0')).toBeInTheDocument();
  });

  it('tells you to sign in when signed out, and checks again on request', () => {
    kiro.status = { state: 'signed-out', path: '~/.local/bin/kiro-cli', version: '3.5.0' };
    renderDialog({});
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(
      screen.getByText(/Sign in with AWS Builder ID or IAM Identity Center\./)
    ).toBeInTheDocument();
    expect(screen.getByText('kiro-cli login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in (Kiro)' })).toBeEnabled();
    // Signed out, Kiro can be picked: the app then asks you to sign in
    expect(screen.getByRole('radio', { name: /Kiro/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Check again (Kiro)' }));
    expect(kiro.refresh).toHaveBeenCalledTimes(1);
  });

  it('disables Check again while it checks', () => {
    kiro.status = { state: 'signed-out', path: '~/.local/bin/kiro-cli', version: '3.5.0' };
    kiro.isRefreshing = true;
    renderDialog({});
    const button = screen.getByRole('button', { name: 'Check again (Kiro)' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Checking…');
  });

  it('asks you to update an unsupported Kiro CLI', () => {
    kiro.status = { state: 'unsupported', path: '~/.local/bin/kiro-cli', version: '2.37.1' };
    renderDialog({});
    expect(screen.getByText('Update needed')).toBeInTheDocument();
    expect(screen.getByText(/Kiro CLI 2\.37\.1 is not supported/)).toBeInTheDocument();
    expect(screen.getByText('kiro-cli update')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Kiro/ })).toBeDisabled();
  });

  it('shows why kiro-cli cannot run', () => {
    kiro.status = { state: 'error', path: '~/bin/kiro-cli', message: 'spawn EACCES' };
    renderDialog({});
    expect(screen.getByText('Cannot run')).toBeInTheDocument();
    expect(screen.getByText('~/bin/kiro-cli')).toBeInTheDocument();
    expect(screen.getByText(/spawn EACCES/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Kiro/ })).toBeDisabled();
  });

  it('does not save while Kiro is the default provider and is signed out', () => {
    kiro.status = { state: 'signed-out', path: '~/.local/bin/kiro-cli', version: '3.5.0' };
    const { onSave } = renderDialog({ preferredProvider: 'kiro' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not saved. Sign in to Kiro, or choose a different default provider.'
    );
    expect(screen.getByRole('status')).toHaveTextContent('Not saved');
    expect(stored().contentDensity).toBe(undefined);
    expect(stored().preferredProvider).toBe('kiro');
  });
});

describe('PreferencesDialog Kiro sign-in', () => {
  const SIGNED_OUT: KiroStatus = {
    state: 'signed-out',
    path: '~/.local/bin/kiro-cli',
    version: '3.6.0',
  };
  const SIGNED_IN: KiroStatus = {
    state: 'signed-in',
    path: '~/.local/bin/kiro-cli',
    version: '3.6.0',
    account: { type: 'builder-id', email: 'dev@example.com' },
  };

  beforeEach(() => {
    resetSignIn();
    localStorage.clear();
    kiro.status = SIGNED_OUT;
    kiro.refresh.mockReset();
    kiro.isRefreshing = false;
  });

  const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in (Kiro)' }));

  const chooseIdentityCenter = () => {
    const trigger = screen.getByLabelText('Sign-in method');
    // jsdom lacks the pointer APIs that Radix Select uses, so open it with the keyboard
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'IAM Identity Center' }));
  };

  it('opens the form with Builder ID selected', () => {
    renderDialog({});
    expect(screen.queryByLabelText('Sign-in method')).not.toBeInTheDocument();
    openForm();
    expect(screen.getByLabelText('Sign-in method')).toHaveTextContent('AWS Builder ID');
    expect(screen.queryByLabelText('Start URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('starts a Builder ID sign-in and keeps the method', () => {
    renderDialog({});
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).toHaveBeenCalledWith({ method: 'builder-id' });
    expect(stored().kiroSignIn).toEqual({ method: 'builder-id' });
  });

  it('asks for the start URL and the Region for IAM Identity Center, and checks them', () => {
    renderDialog({});
    openForm();
    chooseIdentityCenter();
    const url = screen.getByLabelText('Start URL');
    const region = screen.getByLabelText('Region');
    expect(url).toHaveAttribute('placeholder', 'https://my-company.awsapps.com/start');
    expect(region).toHaveAttribute('placeholder', 'us-east-1');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).not.toHaveBeenCalled();
    expect(url).toHaveAccessibleDescription(/Enter the start URL of your IAM Identity Center/);
    expect(region).toHaveAccessibleDescription('Enter a Region, for example us-east-1');

    fireEvent.change(url, { target: { value: 'https://evil.example/start' } });
    fireEvent.change(region, { target: { value: 'us-east-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).not.toHaveBeenCalled();
    expect(region).not.toHaveAccessibleDescription(/Region/);

    fireEvent.change(url, { target: { value: ' https://my-company.awsapps.com/start ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).toHaveBeenCalledWith({
      method: 'identity-center',
      startUrl: 'https://my-company.awsapps.com/start',
      region: 'us-east-1',
    });
    expect(stored().kiroSignIn).toEqual({
      method: 'identity-center',
      startUrl: 'https://my-company.awsapps.com/start',
      region: 'us-east-1',
    });
  });

  it('sends and keeps the start URL in its normalized form', () => {
    renderDialog({});
    openForm();
    chooseIdentityCenter();
    fireEvent.change(screen.getByLabelText('Start URL'), {
      target: { value: 'https://My-Company.AWSAPPS.com' },
    });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'eu-west-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).toHaveBeenCalledWith({
      method: 'identity-center',
      startUrl: 'https://my-company.awsapps.com/',
      region: 'eu-west-1',
    });
    expect(stored().kiroSignIn.startUrl).toBe('https://my-company.awsapps.com/');
  });

  it('refuses a start URL with a hidden character', () => {
    renderDialog({});
    openForm();
    chooseIdentityCenter();
    fireEvent.change(screen.getByLabelText('Start URL'), {
      target: { value: 'https://my-company.awsapps.com/\u202Estart' },
    });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'eu-west-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).not.toHaveBeenCalled();
  });

  it('starts the form with the method that you used last', () => {
    renderDialog({
      kiroSignIn: {
        method: 'identity-center',
        startUrl: 'https://my-company.awsapps.com/start',
        region: 'eu-west-1',
      },
    });
    openForm();
    expect(screen.getByLabelText('Sign-in method')).toHaveTextContent('IAM Identity Center');
    expect(screen.getByLabelText('Start URL')).toHaveValue('https://my-company.awsapps.com/start');
    expect(screen.getByLabelText('Region')).toHaveValue('eu-west-1');
  });

  it('closes the form with Cancel and does not start', () => {
    renderDialog({});
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Sign-in method')).not.toBeInTheDocument();
    expect(signIn.start).not.toHaveBeenCalled();
  });

  it('shows the code and the sign-in link while it waits', () => {
    signIn.phase = 'waiting';
    signIn.code = 'FVVW-JCBH';
    signIn.url = 'https://view.awsapps.com/start/#/device?user_code=FVVW-JCBH';
    renderDialog({});
    expect(
      screen.getByText('Approve the sign-in in the new browser tab. Check that it shows this code:')
    ).toBeInTheDocument();
    const code = screen.getByText('FVVW-JCBH');
    expect(code).toHaveClass('font-mono', 'text-base', 'font-semibold', 'tracking-wider');
    const link = screen.getByRole('link', { name: 'Open sign-in page' });
    expect(link).toHaveAttribute('href', signIn.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(code.closest('[aria-live="polite"]')).not.toBeNull();
    // One sign-in at a time
    expect(screen.getByRole('button', { name: 'Sign in (Kiro)' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signIn.cancel).toHaveBeenCalledTimes(1);
  });

  it('says that the sign-in starts', () => {
    signIn.phase = 'starting';
    renderDialog({});
    expect(screen.getByText('Starting the sign-in…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signIn.cancel).toHaveBeenCalledTimes(1);
  });

  it('shows an error, and Try again goes back to the form', () => {
    signIn.phase = 'error';
    signIn.message = 'Sign-in timed out';
    signIn.reset.mockImplementation(() => {
      signIn.phase = 'idle';
    });
    renderDialog({});
    const message = screen.getByText('Sign-in timed out');
    expect(message).toHaveClass('text-destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(signIn.reset).toHaveBeenCalled();
    expect(screen.getByLabelText('Sign-in method')).toBeInTheDocument();
  });

  it('closes an error with Close', () => {
    signIn.phase = 'error';
    signIn.message = 'Already signed in';
    signIn.reset.mockImplementation(() => {
      signIn.phase = 'idle';
    });
    const { rerender } = renderDialog({});
    // The dialog has its own Close button, so look inside the error panel
    const panel = screen.getByRole('alert').parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(signIn.reset).toHaveBeenCalled();
    // The real hook renders again by itself; the mock needs a push
    rerender();
    expect(screen.queryByText('Already signed in')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sign-in method')).not.toBeInTheDocument();
  });

  it('opens the sign-in when you pick Kiro while signed out, and does not save the choice', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    expect(screen.getByLabelText('Sign-in method')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(stored().preferredProvider).toBe('bedrock');
    expect(screen.getByRole('radio', { name: /Amazon Bedrock/ })).toBeChecked();
  });

  /** The hook ends a sign-in that the app started. The cached status still says signed out. */
  const finishSignIn = () => act(() => signIn.options.onSignedIn?.(SIGNED_IN));

  it('makes Kiro the default when the sign-in ends', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(signIn.start).toHaveBeenCalledWith({ method: 'builder-id' });
    expect(stored().preferredProvider).toBe('bedrock');

    finishSignIn();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'kiro' }));
    expect(stored().preferredProvider).toBe('kiro');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not change the default when only the status turns signed in', () => {
    const { onSave, rerender } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    // A sign-in in a terminal, then Check again
    kiro.status = SIGNED_IN;
    rerender();
    expect(onSave).not.toHaveBeenCalled();
    expect(stored().preferredProvider).toBe('bedrock');
  });

  it('keeps the provider that you picked after Kiro', () => {
    renderDialog({ preferredProvider: 'ollama' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: /Amazon Bedrock/ }));
    expect(stored().preferredProvider).toBe('bedrock');

    finishSignIn();
    expect(stored().preferredProvider).toBe('bedrock');
  });

  it('forgets the wish when the sign-in fails, also when you then check again', () => {
    const { onSave, rerender } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    act(() => signIn.options.onError?.('Sign-in timed out'));

    kiro.status = SIGNED_IN;
    rerender();
    finishSignIn();
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'kiro' }));
    expect(stored().preferredProvider).toBe('bedrock');
  });

  it('makes Kiro the default after the dialog closed, and keeps a theme change from the header', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferredProvider: 'bedrock' }));
    const onSave = vi.fn();
    const ui = (open: boolean) => (
      <PreferencesDialog open={open} onOpenChange={() => {}} onChange={onSave} />
    );
    const { rerender } = render(ui(true));
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    signIn.phase = 'waiting';
    rerender(ui(true));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    rerender(ui(false));

    // The header toggle saves on top of the stored preferences
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored(), visualMode: 'dark' }));
    signIn.phase = 'idle';
    finishSignIn();
    expect(stored()).toMatchObject({ preferredProvider: 'kiro', visualMode: 'dark' });
  });

  it('forgets the wish when the dialog closes with only the form open', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferredProvider: 'bedrock' }));
    const ui = (open: boolean) => (
      <PreferencesDialog open={open} onOpenChange={() => {}} onChange={() => {}} />
    );
    const { rerender } = render(ui(true));
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    rerender(ui(false));
    finishSignIn();
    expect(stored().preferredProvider).toBe('bedrock');
  });

  it('moves focus into each new view of the panel', () => {
    signIn.reset.mockImplementation(() => {
      signIn.phase = 'idle';
    });
    const { rerender } = renderDialog({});
    openForm();
    expect(screen.getByLabelText('Sign-in method')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    signIn.phase = 'starting';
    rerender();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    signIn.phase = 'waiting';
    signIn.code = 'FVVW-JCBH';
    signIn.url = 'https://view.awsapps.com/start/#/device?user_code=FVVW-JCBH';
    rerender();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    signIn.phase = 'error';
    signIn.message = 'Sign-in timed out';
    rerender();
    // The alert announces the message once: no live region around it
    expect(screen.getByRole('alert').closest('[aria-live]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByLabelText('Sign-in method')).toHaveFocus();
  });

  it('does not take the focus when the dialog opens while a sign-in waits', () => {
    signIn.phase = 'waiting';
    signIn.code = 'FVVW-JCBH';
    signIn.url = 'https://view.awsapps.com/start/#/device?user_code=FVVW-JCBH';
    renderDialog({});
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveFocus();
  });

  it('focuses Cancel in the sign-out confirmation', () => {
    kiro.status = SIGNED_IN;
    renderDialog({});
    fireEvent.click(screen.getByRole('button', { name: 'Sign out (Kiro)' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps the default when you cancel the sign-in that the pick started', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Kiro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    finishSignIn();
    expect(onSave).not.toHaveBeenCalled();
    expect(stored().preferredProvider).toBe('bedrock');
  });

  it('offers Sign out when signed in, and confirms it first', async () => {
    kiro.status = SIGNED_IN;
    signIn.signOut.mockResolvedValue(true);
    renderDialog({ preferredProvider: 'bedrock' });
    expect(screen.queryByRole('button', { name: 'Sign in (Kiro)' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out (Kiro)' }));
    const text = screen.getByText(/Sign out of Kiro\?/);
    expect(text).toHaveTextContent(
      'Sign out of Kiro? This also signs out Kiro CLI in your terminals and in other apps on this computer.'
    );
    expect(text).not.toHaveTextContent('Choose a different default provider');
    expect(signIn.signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signIn.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/Sign out of Kiro\?/)).not.toBeInTheDocument());
  });

  it('keeps the confirmation open when sign-out fails', async () => {
    kiro.status = SIGNED_IN;
    signIn.signOut.mockResolvedValue(false);
    signIn.signOutError = 'Kiro CLI could not sign out';
    renderDialog({});
    fireEvent.click(screen.getByRole('button', { name: 'Sign out (Kiro)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signIn.signOut).toHaveBeenCalled());
    expect(screen.getByText('Kiro CLI could not sign out')).toBeInTheDocument();
    expect(screen.getByText(/Sign out of Kiro\?/)).toBeInTheDocument();
  });

  it('tells you to pick another default provider when Kiro is the default', () => {
    kiro.status = SIGNED_IN;
    renderDialog({ preferredProvider: 'kiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out (Kiro)' }));
    expect(screen.getByText(/Sign out of Kiro\?/)).toHaveTextContent(
      'Choose a different default provider after you sign out.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Sign out of Kiro\?/)).not.toBeInTheDocument();
    expect(signIn.signOut).not.toHaveBeenCalled();
  });
});

describe('PreferencesDialog web search', () => {
  beforeEach(() => localStorage.clear());

  const openWebSearchTab = () => {
    // Radix Tabs switch on mousedown, not click
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Web Search' }), { button: 0 });
  };

  it('lists Brave Search, Exa, and Tavily, and disables providers with no key', () => {
    renderDialog({ tavilyApiKey: 'tvly-1' });
    openWebSearchTab();
    expect(screen.getByRole('radio', { name: /Brave Search/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Exa/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Tavily/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Tavily/ })).toBeChecked();
  });

  it('saves a new key and the primary provider', () => {
    const { onSave } = renderDialog({ tavilyApiKey: 'tvly-1' });
    openWebSearchTab();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Exa\)/ }));
    fireEvent.change(screen.getByLabelText('Exa API key'), { target: { value: ' exa-1 ' } });
    const exa = screen.getByRole('radio', { name: /Exa/ });
    expect(exa).toBeEnabled();

    fireEvent.click(exa);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ exaApiKey: 'exa-1', webSearchProvider: 'exa' })
    );
  });

  it('keeps the primary provider when a key for another provider is added', () => {
    const { onSave } = renderDialog({ tavilyApiKey: 'tvly-1' });
    openWebSearchTab();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Brave Search\)/ }));
    fireEvent.change(screen.getByLabelText('Brave Search API key'), { target: { value: 'b' } });
    expect(screen.getByRole('radio', { name: /Tavily/ })).toBeChecked();

    fireEvent.blur(screen.getByLabelText('Brave Search API key'));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ braveApiKey: 'b', webSearchProvider: 'tavily' })
    );
  });

  it('enables the fallback switch only with two or more keys', () => {
    const { onSave } = renderDialog({ braveApiKey: 'b' });
    openWebSearchTab();
    const fallback = screen.getByRole('switch', { name: /Use the next provider/ });
    expect(fallback).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Tavily\)/ }));
    fireEvent.change(screen.getByLabelText('Tavily API key'), { target: { value: 'tvly-1' } });
    expect(fallback).toBeEnabled();
    expect(fallback).toBeChecked();

    fireEvent.click(fallback);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ tavilyApiKey: 'tvly-1', webSearchFallback: false })
    );
  });

  it('shows Search the web by default off and disabled without a key', () => {
    renderDialog({});
    openWebSearchTab();
    const byDefault = screen.getByRole('switch', { name: /Search the web by default/ });
    expect(byDefault).toBeDisabled();
    expect(byDefault).not.toBeChecked();
    expect(screen.getByText('Add a key to use this.')).toBeInTheDocument();
  });

  it('turns on Search the web by default with a key, and saves when it changes', () => {
    const { onSave } = renderDialog({ braveApiKey: 'b' });
    openWebSearchTab();
    const byDefault = screen.getByRole('switch', { name: /Search the web by default/ });
    expect(byDefault).toBeEnabled();
    expect(byDefault).toBeChecked();
    expect(screen.getByText(/New chats start with web search on/)).toBeInTheDocument();

    fireEvent.click(byDefault);
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ webSearchByDefault: false }));
    expect(stored().webSearchByDefault).toBe(false);
    expect(byDefault).not.toBeChecked();
  });

  it('puts Search the web by default above the providers', () => {
    renderDialog({ braveApiKey: 'b' });
    openWebSearchTab();
    const byDefault = screen.getByRole('switch', { name: /Search the web by default/ });
    const providers = screen.getByRole('group', { name: 'Web search providers' });
    expect(
      byDefault.compareDocumentPosition(providers) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe('PreferencesDialog color theme', () => {
  beforeEach(() => localStorage.clear());

  const openDisplayTab = () => {
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
  };

  it('defaults to Neutral and saves the theme picked', () => {
    const { onSave } = renderDialog({});
    openDisplayTab();
    const picker = screen.getByRole('radiogroup', { name: 'Color theme' });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Neutral' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Rosé Pine' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ colorTheme: 'rose-pine' }));
  });

  it('names the variant for the current visual mode', () => {
    renderDialog({ colorTheme: 'cobaltz', visualMode: 'dark' });
    openDisplayTab();
    expect(screen.getByRole('radio', { name: 'Cobaltz' })).toBeChecked();
    // Dark mode shows the dark variant of every theme
    expect(screen.getAllByText('Dark', { selector: '.text-xs' })).toHaveLength(4);
    expect(screen.queryByText('Dawn')).not.toBeInTheDocument();
  });
});

describe('PreferencesDialog closing', () => {
  beforeEach(() => localStorage.clear());

  it('has a Done button instead of Save and Cancel, and says that changes save automatically', () => {
    renderDialog({ preferredProvider: 'bedrock' });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Changes save automatically.');
  });

  it('closes on Escape after a change, with the change already saved', () => {
    const { onSave, onOpenChange } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.click(screen.getByRole('radio', { name: /Ollama/ }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'ollama' }));
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('saves a value that is still being typed when the dialog closes', () => {
    const { onSave, onOpenChange } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
    fireEvent.change(screen.getByLabelText('Avatar initials'), { target: { value: 'pc' } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ avatarInitials: 'PC' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves a typed value on Enter', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
    const initials = screen.getByLabelText('Avatar initials');
    fireEvent.change(initials, { target: { value: 'ab' } });
    fireEvent.keyDown(initials, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ avatarInitials: 'AB' }));
  });
});

describe('PreferencesDialog display radio groups', () => {
  beforeEach(() => localStorage.clear());

  it('names the Appearance and Content density groups', () => {
    renderDialog({});
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Display/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Display/ }));
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Content density' })).toBeInTheDocument();
  });
});

describe('PreferencesDialog appearance', () => {
  beforeEach(() => localStorage.clear());

  it('offers System, Light, and Dark, with System selected by default', () => {
    renderDialog({});
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value'))
    ).toEqual(['system', 'light', 'dark']);
    expect(within(group).getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('keeps a stored Dark choice', () => {
    renderDialog({ visualMode: 'dark' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
});
