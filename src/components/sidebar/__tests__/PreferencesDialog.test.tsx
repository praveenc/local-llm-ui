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
});
