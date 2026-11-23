import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderModels } from '../../../hooks/useAllModels';
import { ProviderChecklist } from '../ProviderChecklist';

const providers: ProviderModels[] = [
  {
    provider: 'bedrock',
    providerName: 'Amazon Bedrock',
    models: [],
    status: 'error',
    error: 'AWS credentials not found.',
  },
  { provider: 'ollama', providerName: 'Ollama', models: [], status: 'error' },
  { provider: 'lmstudio', providerName: 'LM Studio', models: [], status: 'loading' },
];

describe('ProviderChecklist', () => {
  beforeEach(() => localStorage.clear());

  it('lists each provider with its status and fix', () => {
    render(<ProviderChecklist providers={providers} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Connect a model to start');
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('AWS credentials not found.')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Set up AWS credentials' })).toHaveAttribute(
      'href',
      expect.stringContaining('docs.aws.amazon.com')
    );
    expect(within(rows[1]).getByRole('button', { name: 'Copy ollama serve' })).toBeInTheDocument();
    expect(within(rows[2]).getByText('Checking…')).toBeInTheDocument();
  });

  it('opens Preferences to add a key', () => {
    const onOpenPreferences = vi.fn();
    render(<ProviderChecklist providers={providers} onOpenPreferences={onOpenPreferences} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }));
    expect(onOpenPreferences).toHaveBeenCalled();
  });
});
