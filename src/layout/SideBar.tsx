'use client';

import { useEffect, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  CollectionPreferences,
  FormField,
  Icon,
  Input,
  RadioGroup,
  Select,
  SideNavigation,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import { loadPreferences, savePreferences, validateInitials } from '../utils/preferences';
import type { UserPreferences } from '../utils/preferences';

interface SideBarProps {
  selectedModel: SelectProps.Option | null;
  setSelectedModel: (model: SelectProps.Option | null) => void;
  onNewChat?: () => void;
  onPreferencesChange?: (preferences: UserPreferences) => void;
}

type LoadingStatus = 'pending' | 'loading' | 'error' | 'finished';
type Provider = 'lmstudio' | 'ollama' | 'bedrock';

export default function SideBar({
  selectedModel,
  setSelectedModel,
  onNewChat,
  onPreferencesChange,
}: SideBarProps) {
  const [activeHref, setActiveHref] = useState('#/page1');
  const [modelOptions, setModelOptions] = useState<SelectProps.Option[]>([]);
  const [modelsLoadingStatus, setModelsLoadingStatus] = useState<LoadingStatus>('pending');
  const [modelErrorText, setModelErrorText] = useState('');

  // Preferences state - load immediately to avoid double fetch
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [selectedProvider, setSelectedProvider] = useState<Provider>(() => {
    const prefs = loadPreferences();
    return prefs.preferredProvider;
  });
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);

  const handlePreferencesConfirm = (detail: { custom?: UserPreferences }) => {
    if (detail.custom) {
      savePreferences(detail.custom);
      setPreferences(detail.custom);

      // Clear selected model if provider is changing
      if (detail.custom.preferredProvider !== selectedProvider) {
        setSelectedModel(null);
        setModelOptions([]);
      }

      setSelectedProvider(detail.custom.preferredProvider);
      setShowSuccessAlert(true);
      if (onPreferencesChange) {
        onPreferencesChange(detail.custom);
      }
    }
  };

  useEffect(() => {
    const fetchModels = async () => {
      setModelsLoadingStatus('loading');
      setModelErrorText('');

      try {
        const { lmstudioService, ollamaService, bedrockService } = await import('../services');

        // Fetch models from the selected provider
        let service;
        if (selectedProvider === 'lmstudio') {
          service = lmstudioService;
        } else if (selectedProvider === 'ollama') {
          service = ollamaService;
        } else if (selectedProvider === 'bedrock') {
          service = bedrockService;
        } else {
          throw new Error('Invalid provider');
        }
        console.log(`Fetching models from ${selectedProvider}...`);

        const models = await service.getModels();
        console.log(`Received ${models.length} models from ${selectedProvider}:`, models);

        let formattedOptions: SelectProps.Option[];

        // Group Bedrock models by model family
        if (selectedProvider === 'bedrock') {
          // Group models by family
          const modelsByFamily = models.reduce(
            (acc, model) => {
              const family = model.modelFamily || 'Other';
              if (!acc[family]) {
                acc[family] = [];
              }
              acc[family].push({
                label: model.modelName,
                value: model.modelId,
                description: `Provider: ${model.provider}`,
              });
              return acc;
            },
            {} as Record<string, SelectProps.Option[]>
          );

          // Convert to grouped options format
          // Sort families: Anthropic Claude first, then alphabetically
          const sortedFamilies = Object.keys(modelsByFamily).sort((a, b) => {
            if (a === 'Anthropic Claude') return -1;
            if (b === 'Anthropic Claude') return 1;
            return a.localeCompare(b);
          });

          formattedOptions = sortedFamilies.map((family) => ({
            label: family,
            options: modelsByFamily[family],
          }));
        } else {
          // For non-Bedrock providers, use flat list
          formattedOptions = models.map((model) => ({
            label: model.modelName,
            value: model.modelId,
            description: `Provider: ${model.provider}`,
          }));
        }

        console.log('Formatted options:', formattedOptions);

        setModelOptions(formattedOptions);
        setModelsLoadingStatus('finished');

        // Auto-select first model if available and no model is currently selected
        // Handle both flat and grouped options
        const getFirstOption = (options: SelectProps.Option[]): SelectProps.Option | null => {
          if (options.length === 0) return null;
          const first = options[0];
          // If it's a group (has options property), get the first option from the group
          if ('options' in first && Array.isArray(first.options) && first.options.length > 0) {
            return first.options[0];
          }
          // Otherwise it's a flat option
          return first;
        };

        const isOptionValid = (options: SelectProps.Option[], value: string): boolean => {
          for (const opt of options) {
            // Check if it's a group (has options property)
            if ('options' in opt && Array.isArray(opt.options)) {
              // It's a group, check nested options
              if (opt.options.some((o: SelectProps.Option) => o.value === value)) {
                return true;
              }
            } else if (opt.value === value) {
              // It's a flat option
              return true;
            }
          }
          return false;
        };

        if (formattedOptions.length > 0 && !selectedModel) {
          const firstOption = getFirstOption(formattedOptions);
          if (firstOption) {
            setSelectedModel(firstOption);
          }
        } else if (formattedOptions.length > 0 && selectedModel) {
          // Check if current selection is still valid AND belongs to current provider
          const stillValid = isOptionValid(formattedOptions, selectedModel.value || '');
          const belongsToCurrentProvider = selectedModel.description
            ?.toLowerCase()
            .includes(selectedProvider.toLowerCase());

          if (!stillValid || !belongsToCurrentProvider) {
            const firstOption = getFirstOption(formattedOptions);
            if (firstOption) {
              setSelectedModel(firstOption);
            }
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
        } else if (selectedProvider === 'bedrock') {
          const err = error as Error;
          if (err.message?.includes('credentials') || err.message?.includes('AWS')) {
            errorMessage = err.message;
          } else {
            errorMessage = 'Cannot connect to Amazon Bedrock. Please configure AWS credentials.';
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                  selectedProvider === 'lmstudio'
                    ? 'LM Studio not running'
                    : selectedProvider === 'ollama'
                      ? 'Ollama not running'
                      : 'Amazon Bedrock connection failed'
                }
              >
                {selectedProvider === 'lmstudio' && (
                  <>Please start LM Studio and ensure it's running on port 1234.</>
                )}
                {selectedProvider === 'ollama' && (
                  <>Please start Ollama and ensure it's running on port 11434.</>
                )}
                {selectedProvider === 'bedrock' && (
                  <>{modelErrorText || 'Please configure AWS credentials to use Amazon Bedrock.'}</>
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
                {selectedProvider === 'bedrock' && (
                  <>
                    No models found. Please check your AWS credentials and IAM permissions for
                    Amazon Bedrock.
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
                          src="/bedrock_bw.svg"
                          alt="Amazon Bedrock"
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>Amazon Bedrock</span>
                      </span>
                    ),
                    description: 'AWS cloud AI models',
                  },
                ]}
              />
            </FormField>

            <FormField
              label={
                <Box>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Icon name="gen-ai" size="small" />
                    <span>Select Model</span>
                  </SpaceBetween>
                </Box>
              }
              stretch={true}
            >
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
                disabled={modelsLoadingStatus === 'error'}
                renderHighlightedAriaLive={(item) => item.label || ''}
              />
            </FormField>
          </SpaceBetween>
        }
        items={[]}
      />

      {/* Success Alert */}
      {showSuccessAlert && (
        <Box padding={{ horizontal: 's' }}>
          <Alert type="success" dismissible onDismiss={() => setShowSuccessAlert(false)}>
            Preferences saved successfully
          </Alert>
        </Box>
      )}

      {/* Preferences Section at Bottom */}
      <Box padding={{ horizontal: 's', bottom: 's' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name="settings" size="medium" />
          <span style={{ flex: 1, fontWeight: 600 }}>Preferences</span>
          <CollectionPreferences
            title="User Preferences"
            confirmLabel="Save"
            cancelLabel="Cancel"
            preferences={{ custom: preferences }}
            onConfirm={({ detail }) => handlePreferencesConfirm(detail)}
            customPreference={(customValue, setCustomValue) => (
              <SpaceBetween size="l">
                <FormField label="Preferred Provider" stretch={true}>
                  <Select
                    selectedOption={{
                      label:
                        customValue.preferredProvider === 'ollama'
                          ? 'Ollama'
                          : customValue.preferredProvider === 'lmstudio'
                            ? 'LM Studio'
                            : 'Amazon Bedrock',
                      value: customValue.preferredProvider,
                    }}
                    onChange={({ detail }) =>
                      setCustomValue({
                        ...customValue,
                        preferredProvider: detail.selectedOption.value as Provider,
                      })
                    }
                    options={[
                      { label: 'Ollama', value: 'ollama' },
                      { label: 'LM Studio', value: 'lmstudio' },
                      { label: 'Amazon Bedrock', value: 'bedrock' },
                    ]}
                  />
                </FormField>

                <FormField
                  label="Avatar Initials"
                  description="Max 2 alphanumeric characters"
                  stretch={true}
                >
                  <Input
                    value={customValue.avatarInitials}
                    onChange={({ detail }) =>
                      setCustomValue({
                        ...customValue,
                        avatarInitials: validateInitials(detail.value),
                      })
                    }
                    placeholder="PC"
                  />
                </FormField>
              </SpaceBetween>
            )}
          />
        </div>
      </Box>
    </SpaceBetween>
  );
}
