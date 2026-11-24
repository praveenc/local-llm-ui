import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const STORAGE_KEY = 'local-llm-ui-preferences';

const renderDialog = (stored: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(<PreferencesDialog open onOpenChange={onOpenChange} onChange={onSave} />);
  return { onSave, onOpenChange };
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
    trigger.focus();
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
    // Kiro has no thinking effort row
    expect(screen.queryByText('Default thinking')).not.toBeInTheDocument();
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
    expect(screen.getByText('kiro-cli login')).toBeInTheDocument();
    expect(screen.getByText(/in a terminal, then click Check again\./)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Kiro/ })).toBeDisabled();

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
