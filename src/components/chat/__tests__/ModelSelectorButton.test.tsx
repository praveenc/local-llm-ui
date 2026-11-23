import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelSelectorButton } from '../ModelSelectorButton';

describe('ModelSelectorButton', () => {
  it('opens on Ctrl+K and shows the shortcut in its tooltip', () => {
    render(<ModelSelectorButton providers={[]} selectedModel={null} onSelectModel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Select model/ })).toHaveAttribute(
      'title',
      expect.stringMatching(/K\)$/)
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Search models...')).toBeInTheDocument();
  });

  it('ignores the shortcut while disabled', () => {
    render(
      <ModelSelectorButton providers={[]} selectedModel={null} onSelectModel={vi.fn()} disabled />
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Search models...')).not.toBeInTheDocument();
  });

  it('groups models by provider with a status heading and a detail line', () => {
    render(
      <ModelSelectorButton
        providers={[
          {
            provider: 'ollama',
            providerName: 'Ollama',
            status: 'success',
            models: [
              {
                id: 'qwen3',
                name: 'qwen3',
                provider: 'ollama',
                providerName: 'Ollama',
                family: 'qwen3',
                supportsThinking: true,
              },
            ],
          },
          { provider: 'lmstudio', providerName: 'LM Studio', status: 'error', models: [] },
        ]}
        selectedModel={null}
        onSelectModel={vi.fn()}
      />
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Ollama · 1 model')).toBeInTheDocument();
    expect(screen.getByText('qwen3 · Thinking')).toBeInTheDocument();
    expect(screen.getByText('LM Studio · Not running')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to start' })).toBeInTheDocument();
  });
});
