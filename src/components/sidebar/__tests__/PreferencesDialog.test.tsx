import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesDialog } from '../PreferencesDialog';

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
  beforeEach(() => localStorage.clear());

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
