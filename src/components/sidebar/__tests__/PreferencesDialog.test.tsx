import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesDialog } from '../PreferencesDialog';

const STORAGE_KEY = 'local-llm-ui-preferences';

const renderDialog = (stored: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  const onSave = vi.fn();
  render(<PreferencesDialog open onOpenChange={vi.fn()} onSave={onSave} />);
  return { onSave };
};

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'bedrock' }));
  });

  it('enables a provider once its key is added in its row', () => {
    const { onSave } = renderDialog({ preferredProvider: 'bedrock' });
    const groq = screen.getByRole('radio', { name: /Groq/ });
    expect(groq).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Groq\)/ }));
    fireEvent.change(screen.getByLabelText('Groq API key'), { target: { value: ' gsk_1 ' } });
    expect(groq).toBeEnabled();

    fireEvent.click(groq);
    save();
    expect(onSave).toHaveBeenCalledWith(
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

  it('blocks save when the default provider has lost its API key', () => {
    const { onSave } = renderDialog({ preferredProvider: 'groq' });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Add an API key for Groq');
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
    save();
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
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ exaApiKey: 'exa-1', webSearchProvider: 'exa' })
    );
  });

  it('keeps the primary provider when a key for another provider is added', () => {
    const { onSave } = renderDialog({ tavilyApiKey: 'tvly-1' });
    openWebSearchTab();

    fireEvent.click(screen.getByRole('button', { name: /Add key \(Brave Search\)/ }));
    fireEvent.change(screen.getByLabelText('Brave Search API key'), { target: { value: 'b' } });
    expect(screen.getByRole('radio', { name: /Tavily/ })).toBeChecked();

    save();
    expect(onSave).toHaveBeenCalledWith(
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
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ webSearchFallback: false }));
  });
});

describe('PreferencesDialog color theme', () => {
  beforeEach(() => localStorage.clear());

  const openDisplayTab = () => {
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Display' }), { button: 0 });
  };

  it('defaults to Cosmic Night and saves the theme picked', () => {
    const { onSave } = renderDialog({});
    openDisplayTab();
    const picker = screen.getByRole('radiogroup', { name: 'Color theme' });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cosmic Night' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Rosé Pine' }));
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ colorTheme: 'rose-pine' }));
  });

  it('names the variant for the current visual mode', () => {
    renderDialog({ colorTheme: 'cobaltz', visualMode: 'dark' });
    openDisplayTab();
    expect(screen.getByRole('radio', { name: 'Cobaltz' })).toBeChecked();
    // Dark mode shows the dark variant of every theme
    expect(screen.getAllByText('Dark', { selector: '.text-xs' })).toHaveLength(3);
    expect(screen.queryByText('Dawn')).not.toBeInTheDocument();
  });
});
