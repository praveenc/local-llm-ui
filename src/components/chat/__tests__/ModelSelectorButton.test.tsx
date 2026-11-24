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

  it('shows a short label with the profile, and finds a model by a name with a dot', async () => {
    const haiku = {
      id: 'global.anthropic.claude-haiku-5-5',
      name: 'Global Anthropic Claude Haiku 5.5',
      provider: 'bedrock' as const,
      providerName: 'Amazon Bedrock',
    };
    render(
      <ModelSelectorButton
        providers={[
          {
            provider: 'bedrock',
            providerName: 'Amazon Bedrock',
            status: 'success',
            models: [
              haiku,
              {
                id: 'us.anthropic.claude-sonnet-5-5',
                name: 'US Anthropic Claude Sonnet 5.5',
                provider: 'bedrock',
                providerName: 'Amazon Bedrock',
              },
            ],
          },
        ]}
        selectedModel={haiku}
        onSelectModel={vi.fn()}
      />
    );
    const chip = screen.getByRole('button', { name: /Claude Haiku 5\.5 · Global/ });
    expect(chip).not.toHaveTextContent('Amazon Bedrock');
    expect(chip).toHaveAttribute(
      'title',
      expect.stringContaining('Global Anthropic Claude Haiku 5.5 · Amazon Bedrock')
    );

    fireEvent.click(chip);
    fireEvent.change(screen.getByPlaceholderText('Search models...'), {
      target: { value: 'Sonnet 5.5' },
    });
    expect(
      await screen.findByRole('option', { name: /Claude Sonnet 5\.5 · US/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Haiku/ })).not.toBeInTheDocument();
  });
});
