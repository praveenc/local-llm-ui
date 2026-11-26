import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderModels } from '../../../hooks/useAllModels';
import type { Provider } from '../../../utils/preferences';
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

  it("lists Kiro's models in Kiro's order with the description, credit rate, and local logo", () => {
    const kiro = (id: string, name: string, description?: string, rate?: number) => ({
      id,
      name,
      provider: 'kiro' as const,
      providerName: 'Kiro',
      kiro: { description, rateMultiplier: rate },
    });
    const onOpenPreferences = vi.fn();
    render(
      <ModelSelectorButton
        providers={[
          {
            provider: 'kiro',
            providerName: 'Kiro',
            status: 'success',
            models: [
              kiro('auto', 'Auto', 'Models chosen by task for optimal usage', 1),
              kiro(
                'claude-opus-5.5',
                'Claude Opus 5.5',
                'Claude Opus 5.5 model with 1M context window',
                2
              ),
              kiro('agi-nova-beta-1m', 'AGI Nova Beta 1M'),
            ],
          },
        ]}
        selectedModel={kiro('claude-opus-5.5', 'Claude Opus 5.5')}
        onSelectModel={vi.fn()}
        onOpenPreferences={onOpenPreferences}
      />
    );
    // The chip in the chat input uses the app's own Kiro logo
    expect(screen.getByRole('img', { name: 'kiro logo' })).toHaveAttribute(
      'src',
      '/kiro-color.svg'
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Kiro · 3 models')).toBeInTheDocument();
    const names = screen
      .getAllByRole('option')
      .map((option) => option.querySelector('span')?.textContent);
    expect(names).toEqual(['Auto', 'Claude Opus 5.5', 'AGI Nova Beta 1M']);
    expect(
      screen.getByText('Claude Opus 5.5 model with 1M context window · 2× credits')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Models chosen by task for optimal usage · 1× credits')
    ).toBeInTheDocument();
  });

  it('asks to sign in to Kiro from the picker', () => {
    const onOpenPreferences = vi.fn();
    render(
      <ModelSelectorButton
        providers={[
          {
            provider: 'kiro',
            providerName: 'Kiro',
            status: 'error',
            models: [],
            error: 'Sign in to Kiro in Preferences → Providers',
          },
        ]}
        selectedModel={null}
        onSelectModel={vi.fn()}
        onOpenPreferences={onOpenPreferences}
      />
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Kiro · Not signed in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Kiro' }));
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
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

  describe('group order', () => {
    const entry = (provider: Provider, providerName: string, ...ids: string[]): ProviderModels => ({
      provider,
      providerName,
      status: 'success',
      models: ids.map((id) => ({ id, name: id, provider, providerName })),
    });
    // Bedrock is first in the list, as in the app
    const providers = [
      entry('ollama', 'Ollama', 'llama-a'),
      entry('bedrock', 'Amazon Bedrock', 'model-a', 'model-b'),
      entry('kiro', 'Kiro', 'model-c'),
    ];
    const headings = () =>
      Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((el) => el.textContent);

    it('shows the group of the selected model first', () => {
      render(
        <ModelSelectorButton
          providers={providers}
          selectedModel={providers[2].models[0]}
          defaultProvider="ollama"
          onSelectModel={vi.fn()}
        />
      );
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(headings()).toEqual([
        'Kiro · 1 model',
        'Ollama · 1 model',
        'Amazon Bedrock · 2 models',
      ]);
      // The picker opens on the first row of the list
      expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('option')[0]).toHaveTextContent('model-c');
    });

    it('shows the default provider first when no model is selected', () => {
      render(
        <ModelSelectorButton
          providers={providers}
          selectedModel={null}
          defaultProvider="bedrock"
          onSelectModel={vi.fn()}
        />
      );
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(headings()).toEqual([
        'Amazon Bedrock · 2 models',
        'Ollama · 1 model',
        'Kiro · 1 model',
      ]);
    });

    it('keeps the list order with no model and no default provider', () => {
      render(
        <ModelSelectorButton providers={providers} selectedModel={null} onSelectModel={vi.fn()} />
      );
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(headings()).toEqual([
        'Ollama · 1 model',
        'Amazon Bedrock · 2 models',
        'Kiro · 1 model',
      ]);
    });

    it('keeps the current provider first while you search, also when another group matches better', async () => {
      const search = [
        entry('bedrock', 'Amazon Bedrock', 'zz-claude-opus-long-name'),
        entry('kiro', 'Kiro', 'opus'),
      ];
      render(
        <ModelSelectorButton
          providers={search}
          selectedModel={search[0].models[0]}
          onSelectModel={vi.fn()}
        />
      );
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      fireEvent.change(screen.getByPlaceholderText('Search models...'), {
        target: { value: 'opus' },
      });
      await screen.findAllByRole('option');
      expect(screen.getAllByRole('option')).toHaveLength(2);
      // Kiro has the best match, but the Bedrock group stays on top. This guards against a cmdk
      // that sorts groups by score.
      expect(headings()).toEqual(['Amazon Bedrock · 1 model', 'Kiro · 1 model']);
    });
  });
});
