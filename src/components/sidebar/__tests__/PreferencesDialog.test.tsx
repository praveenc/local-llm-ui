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

describe('PreferencesDialog default provider', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredProvider: 'bedrock' }));
  });

  it('blocks save when the default provider has lost its API key', () => {
    const { onSave } = renderDialog({ preferredProvider: 'groq' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Add an API key for Groq/)).toBeInTheDocument();
  });
});
