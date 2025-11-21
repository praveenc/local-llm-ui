'use client';

import { useEffect, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  FormField,
  RadioGroup,
  Select,
  SideNavigation,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

interface SideBarProps {
  selectedModel: SelectProps.Option | null;
  setSelectedModel: (model: SelectProps.Option | null) => void;
  onNewChat?: () => void;
}

type LoadingStatus = 'pending' | 'loading' | 'error' | 'finished';
type Provider = 'lmstudio' | 'ollama' | 'bedrock';

export default function SideBar({ selectedModel, setSelectedModel, onNewChat }: SideBarProps) {
  const [activeHref, setActiveHref] = useState('#/page1');
  const [modelOptions, setModelOptions] = useState<SelectProps.Option[]>([]);
  const [modelsLoadingStatus, setModelsLoadingStatus] = useState<LoadingStatus>('pending');
  const [modelErrorText, setModelErrorText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Provider>('ollama');

  useEffect(() => {
    const fetchModels = async () => {
      setModelsLoadingStatus('loading');
      setModelErrorText('');

      try {
        const { lmstudioService, ollamaService } = await import('../services');

        // Fetch models from the selected provider
        let service;
        if (selectedProvider === 'lmstudio') {
          service = lmstudioService;
        } else if (selectedProvider === 'ollama') {
          service = ollamaService;
        } else {
          throw new Error('Invalid provider');
        }
        console.log(`Fetching models from ${selectedProvider}...`);

        const models = await service.getModels();
        console.log(`Received ${models.length} models from ${selectedProvider}:`, models);

        const formattedOptions = models.map((model) => ({
          label: model.modelName,
          value: model.modelId,
          description: `Provider: ${model.provider}`,
        }));

        console.log('Formatted options:', formattedOptions);

        setModelOptions(formattedOptions);
        setModelsLoadingStatus('finished');

        // Auto-select first model if available and no model is currently selected
        if (formattedOptions.length > 0 && !selectedModel) {
          setSelectedModel(formattedOptions[0]);
        } else if (formattedOptions.length > 0 && selectedModel) {
          // Check if current selection is still valid
          const stillValid = formattedOptions.some((opt) => opt.value === selectedModel.value);
          if (!stillValid) {
            setSelectedModel(formattedOptions[0]);
          }
        } else {
          setSelectedModel(null);
        }
      } catch (error) {
        console.error(`Failed to fetch ${selectedProvider} models:`, error);

        let errorMessage = '';
        if (selectedProvider === 'lmstudio') {
          errorMessage =
            'Cannot connect to LMStudio (port 1234). Please ensure LMStudio is running.';
        } else if (selectedProvider === 'ollama') {
          errorMessage = 'Cannot connect to Ollama (port 11434). Please ensure Ollama is running.';
        } else {
          errorMessage = 'Invalid provider selected.';
        }

        setModelErrorText(errorMessage);
        setModelsLoadingStatus('error');
        setModelOptions([]);
        setSelectedModel(null);
      }
    };

    fetchModels();
  }, [selectedProvider]);

  return (
    <SpaceBetween direction="vertical" size="m">
      {onNewChat && (
        <Box padding={{ top: 'm', horizontal: 's' }}>
          <Button onClick={onNewChat} variant="primary" iconName="add-plus" fullWidth>
            New Chat
          </Button>
        </Box>
      )}
      <SideNavigation
        activeHref={activeHref}
        header={{ href: '#/', text: 'Model Settings' }}
        onFollow={(event) => {
          if (!event.detail.external) {
            event.preventDefault();
            setActiveHref(event.detail.href);
          }
        }}
        itemsControl={
          <SpaceBetween size="l">
            {modelsLoadingStatus === 'error' && (
              <Alert
                type="warning"
                header={
                  selectedProvider === 'lmstudio' ? 'LM Studio not running' : 'Ollama not running'
                }
              >
                {selectedProvider === 'lmstudio' && (
                  <>Please start LM Studio and ensure it's running on port 1234.</>
                )}
                {selectedProvider === 'ollama' && (
                  <>Please start Ollama and ensure it's running on port 11434.</>
                )}
              </Alert>
            )}

            {modelsLoadingStatus === 'finished' && modelOptions.length === 0 && (
              <Alert type="info" header="No models available">
                {selectedProvider === 'lmstudio' && (
                  <>
                    Load a model in LM Studio or enable JIT Loading in Developer &gt; Server
                    Settings.
                  </>
                )}
                {selectedProvider === 'ollama' && (
                  <>
                    Pull a model using: <code>ollama pull llama2</code>
                  </>
                )}
              </Alert>
            )}

            <FormField label="AI Provider" stretch={true}>
              <RadioGroup
                value={selectedProvider}
                onChange={({ detail }) => setSelectedProvider(detail.value as Provider)}
                items={[
                  {
                    value: 'ollama',
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img
                          src="/ollama_icon.svg"
                          alt="Ollama"
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>Ollama</span>
                      </span>
                    ),
                    description: 'Local AI models (port 11434)',
                  },
                  {
                    value: 'lmstudio',
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img
                          src="/lmstudio_icon.svg"
                          alt="LM Studio"
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>LM Studio</span>
                      </span>
                    ),
                    description: 'LM Studio server (port 1234)',
                  },
                  {
                    value: 'bedrock',
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img
                          src="/bedrock-color.svg"
                          alt="Amazon Bedrock"
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>Amazon Bedrock</span>
                      </span>
                    ),
                    description: 'Coming soon',
                    disabled: true,
                  },
                ]}
              />
            </FormField>

            <FormField label="Select Model" stretch={true}>
              <Select
                selectedOption={selectedModel}
                onChange={({ detail }) => setSelectedModel(detail.selectedOption)}
                options={modelOptions}
                statusType={
                  modelsLoadingStatus === 'error'
                    ? 'error'
                    : modelsLoadingStatus === 'loading'
                      ? 'loading'
                      : 'finished'
                }
                loadingText="Loading models..."
                errorText={modelErrorText}
                placeholder={modelsLoadingStatus === 'loading' ? 'Loading...' : 'Choose a model'}
                filteringType="auto"
                ariaLabel="Model selection"
                disabled={modelsLoadingStatus === 'loading' || modelsLoadingStatus === 'error'}
              />
            </FormField>
          </SpaceBetween>
        }
        items={[]}
      />
    </SpaceBetween>
  );
}
