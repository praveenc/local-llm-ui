'use client';

import { useEffect, useState } from 'react';

import {
  Box,
  Button,
  CollectionPreferences,
  ColumnLayout,
  FormField,
  Icon,
  Input,
  RadioGroup,
  Select,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import {
  ConversationList,
  ModelLoadingConfirmModal,
  ModelLoadingProgress,
} from '../components/chat';
import { useModelLoader } from '../hooks';
import { syncApiKeysFromPreferences } from '../services/aisdk';
import '../styles/conversationList.scss';
import '../styles/sidebar.scss';
import { loadPreferences, savePreferences, validateInitials } from '../utils/preferences';
import type { ContentDensity, UserPreferences, VisualMode } from '../utils/preferences';

type LoadingStatus = 'pending' | 'loading' | 'error' | 'finished';
type Provider = 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle' | 'groq' | 'cerebras';

// Mantle regions for the dropdown
const MANTLE_REGIONS = [
  { label: 'US East (N. Virginia)', value: 'us-east-1' },
  { label: 'US East (Ohio)', value: 'us-east-2' },
  { label: 'US West (Oregon)', value: 'us-west-2' },
  { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
  { label: 'Asia Pacific (Jakarta)', value: 'ap-southeast-3' },
  { label: 'Europe (Frankfurt)', value: 'eu-central-1' },
  { label: 'Europe (Ireland)', value: 'eu-west-1' },
  { label: 'Europe (London)', value: 'eu-west-2' },
  { label: 'Europe (Milan)', value: 'eu-south-1' },
  { label: 'Europe (Stockholm)', value: 'eu-north-1' },
  { label: 'South America (São Paulo)', value: 'sa-east-1' },
];

// Provider display info
const PROVIDER_INFO: Record<
  Provider,
  { label: string; shortLabel: string; icon: string; description: string; iconAlt: string }
> = {
  bedrock: {
    label: 'Amazon Bedrock',
    shortLabel: 'Bedrock',
    icon: '/bedrock_bw.svg',
    description: 'AWS credentials',
    iconAlt: 'Amazon Bedrock',
  },
  'bedrock-mantle': {
    label: 'Bedrock Mantle',
    shortLabel: 'Mantle',
    icon: '/bedrock-color.svg',
    description: 'API key required',
    iconAlt: 'Bedrock Mantle',
  },
  lmstudio: {
    label: 'LM Studio',
    shortLabel: 'LM Studio',
    icon: '/lmstudio_icon.svg',
    description: 'Port 1234',
    iconAlt: 'LM Studio',
  },
  ollama: {
    label: 'Ollama',
    shortLabel: 'Ollama',
    icon: '/ollama_icon.svg',
    description: 'Port 11434',
    iconAlt: 'Ollama',
  },
  groq: {
    label: 'Groq',
    shortLabel: 'Groq',
    icon: '/groq_icon.svg',
    description: 'API key required',
    iconAlt: 'Groq',
  },
  cerebras: {
    label: 'Cerebras',
    shortLabel: 'Cerebras',
    icon: '/cerebras_icon.svg',
    description: 'API key required',
    iconAlt: 'Cerebras',
  },
};

interface SideBarProps {
  selectedModel: SelectProps.Option | null;
  setSelectedModel: (model: SelectProps.Option | null) => void;
  onNewChat?: () => void;
  onPreferencesChange?: (preferences: UserPreferences) => void;
  onPreferencesSaved?: () => void;
  selectedProvider: Provider;
  onProviderChange: (provider: Provider) => void;
  onModelLoadError?: (error: { title: string; content: string }) => void;
  onModelLoadSuccess?: (modelName: string) => void;
  onModelStatusChange?: (
    status: {
      type: 'error' | 'warning' | 'info';
      header: string;
      content: string;
    } | null
  ) => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export default function SideBar({
  selectedModel,
  setSelectedModel,
  onNewChat,
  onPreferencesChange,
  onPreferencesSaved,
  selectedProvider,
  onProviderChange,
  onModelLoadError,
  onModelLoadSuccess,
  onModelStatusChange,
  activeConversationId,
  onSelectConversation,
}: SideBarProps) {
  const [modelOptions, setModelOptions] = useState<SelectProps.Option[]>([]);
  const [modelsLoadingStatus, setModelsLoadingStatus] = useState<LoadingStatus>('pending');
  const [modelErrorText, setModelErrorText] = useState('');

  // Model loading flow state
  const [showLoadConfirm, setShowLoadConfirm] = useState(false);
  const [pendingModel, setPendingModel] = useState<SelectProps.Option | null>(null);
  const modelLoader = useModelLoader();

  // Preferences state - load immediately to avoid double fetch
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());

  // Handle model selection - loads the model for LM Studio
  const handleModelSelect = async (option: SelectProps.Option | null) => {
    if (!option) {
      setSelectedModel(null);
      return;
    }

    // For LM Studio, show confirmation modal before loading
    if (selectedProvider === 'lmstudio' && option.value) {
      setPendingModel(option);
      setShowLoadConfirm(true);
    } else {
      // For other providers, just set the model
      setSelectedModel(option);
    }
  };

  // Handle confirmed model loading
  const handleConfirmLoad = async () => {
    if (!pendingModel?.value) return;

    setShowLoadConfirm(false);

    // Store pending model info before async operation
    const modelToLoad = pendingModel;

    try {
      // loadModel now returns the result directly
      const result = await modelLoader.loadModel(modelToLoad.value!);

      if (result.success && result.loadedModel) {
        // Update dropdown with the loaded model
        setSelectedModel(modelToLoad);
        if (onModelLoadSuccess) {
          onModelLoadSuccess(modelToLoad.label || modelToLoad.value || 'Unknown');
        }
      } else if (result.error) {
        console.error('Failed to load model:', result.error);
        if (onModelLoadError) {
          onModelLoadError({
            title: 'Failed to load model',
            content: result.error,
          });
        }
      }
    } catch (error) {
      console.error('Error loading model:', error);
      const err = error as Error;
      if (onModelLoadError) {
        onModelLoadError({
          title: 'Failed to load model',
          content: err.message || 'An unknown error occurred while loading the model.',
        });
      }
    } finally {
      setPendingModel(null);
      modelLoader.reset();
    }
  };

  // Handle cancel loading
  const handleCancelLoad = () => {
    setShowLoadConfirm(false);
    setPendingModel(null);
  };

  // Handle cancel during progress
  const handleCancelProgress = () => {
    modelLoader.cancelLoading();
    setPendingModel(null);
  };

  const handlePreferencesConfirm = (detail: { custom?: UserPreferences }) => {
    if (detail.custom) {
      savePreferences(detail.custom);
      setPreferences(detail.custom);

      // Clear selected model if provider is changing
      if (detail.custom.preferredProvider !== selectedProvider) {
        setSelectedModel(null);
        setModelOptions([]);
      }

      onProviderChange(detail.custom.preferredProvider);

      // Notify parent for page-level flashbar notification
      if (onPreferencesSaved) {
        onPreferencesSaved();
      }

      if (onPreferencesChange) {
        onPreferencesChange(detail.custom);
      }
    }
  };

  useEffect(() => {
    const fetchModels = async () => {
      setModelsLoadingStatus('loading');
      setModelErrorText('');
      // Clear any previous status
      onModelStatusChange?.(null);

      try {
        const { lmstudioService, ollamaService, bedrockService, mantleService } = await import(
          '../services'
        );

        // For Mantle, configure the service with API key and region from preferences
        if (selectedProvider === 'bedrock-mantle') {
          const currentPrefs = loadPreferences();
          if (!currentPrefs.bedrockMantleApiKey) {
            const errorMsg = 'Bedrock API key is required. Please configure it in the preferences.';
            setModelErrorText(errorMsg);
            setModelsLoadingStatus('error');
            setModelOptions([]);
            setSelectedModel(null);
            onModelStatusChange?.({
              type: 'info',
              header: 'Bedrock API Key Required',
              content: `${errorMsg} Region: ${currentPrefs.bedrockMantleRegion || 'us-west-2'}`,
            });
            return;
          }
          mantleService.setApiKey(currentPrefs.bedrockMantleApiKey);
          mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
        }

        // Fetch models from the selected provider
        let service;
        if (selectedProvider === 'lmstudio') {
          service = lmstudioService;
        } else if (selectedProvider === 'ollama') {
          service = ollamaService;
        } else if (selectedProvider === 'bedrock') {
          service = bedrockService;
        } else if (selectedProvider === 'bedrock-mantle') {
          service = mantleService;
        } else {
          throw new Error('Invalid provider');
        }
        console.log(`Fetching models from ${selectedProvider}...`);

        const models = await service.getModels();
        console.log(`Received ${models.length} models from ${selectedProvider}:`, models);

        let formattedOptions: SelectProps.Option[];

        // Group Bedrock models by model family
        if (selectedProvider === 'bedrock') {
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
          formattedOptions = models.map((model) => ({
            label: model.modelName,
            value: model.modelId,
            description: `Provider: ${model.provider}`,
          }));
        }

        setModelOptions(formattedOptions);
        setModelsLoadingStatus('finished');

        // Notify if no models available
        if (formattedOptions.length === 0) {
          let emptyMessage = '';
          if (selectedProvider === 'lmstudio') {
            emptyMessage =
              'Load a model in LM Studio or enable JIT Loading in Developer > Server Settings.';
          } else if (selectedProvider === 'ollama') {
            emptyMessage = 'Pull a model using: ollama pull llama2';
          } else if (selectedProvider === 'bedrock') {
            emptyMessage =
              'No models found. Please check your AWS credentials and IAM permissions for Amazon Bedrock.';
          } else if (selectedProvider === 'bedrock-mantle') {
            emptyMessage =
              'No models found. Please check your Bedrock API key and ensure you have access to Mantle models.';
          }
          onModelStatusChange?.({
            type: 'info',
            header: 'No models available',
            content: emptyMessage,
          });
        }

        const getFirstOption = (options: SelectProps.Option[]): SelectProps.Option | null => {
          if (options.length === 0) return null;
          const first = options[0];
          if ('options' in first && Array.isArray(first.options) && first.options.length > 0) {
            return first.options[0];
          }
          return first;
        };

        const isOptionValid = (options: SelectProps.Option[], value: string): boolean => {
          for (const opt of options) {
            if ('options' in opt && Array.isArray(opt.options)) {
              if (opt.options.some((o: SelectProps.Option) => o.value === value)) {
                return true;
              }
            } else if (opt.value === value) {
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
          const stillValid = isOptionValid(formattedOptions, selectedModel.value || '');
          const belongsToCurrentProvider = selectedModel.description
            ?.toLowerCase()
            .includes(selectedProvider.toLowerCase().replace('-', ''));

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
        let errorHeader = '';
        if (selectedProvider === 'lmstudio') {
          errorHeader = 'LM Studio not running';
          errorMessage =
            'Cannot connect to LM Studio (port 1234). Please ensure LM Studio is running.';
        } else if (selectedProvider === 'ollama') {
          errorHeader = 'Ollama not running';
          errorMessage = 'Cannot connect to Ollama (port 11434). Please ensure Ollama is running.';
        } else if (selectedProvider === 'bedrock') {
          errorHeader = 'Amazon Bedrock connection failed';
          const err = error as Error;
          if (err.message?.includes('credentials') || err.message?.includes('AWS')) {
            errorMessage = err.message;
          } else {
            errorMessage = 'Cannot connect to Amazon Bedrock. Please configure AWS credentials.';
          }
        } else if (selectedProvider === 'bedrock-mantle') {
          errorHeader = 'Bedrock Mantle connection failed';
          const err = error as Error;
          if (err.message?.includes('API key')) {
            errorMessage = err.message;
          } else {
            errorMessage =
              'Cannot connect to Bedrock Mantle. Please check your Bedrock API key in preferences.';
          }
        } else {
          errorHeader = 'Connection Error';
          errorMessage = 'Invalid provider selected.';
        }

        setModelErrorText(errorMessage);
        setModelsLoadingStatus('error');
        setModelOptions([]);
        setSelectedModel(null);

        // Notify parent about the error
        onModelStatusChange?.({
          type: 'warning',
          header: errorHeader,
          content: errorMessage,
        });
      }
    };

    // Sync AI SDK API keys to localStorage
    syncApiKeysFromPreferences(preferences.groqApiKey, preferences.cerebrasApiKey);

    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProvider,
    preferences.bedrockMantleApiKey,
    preferences.bedrockMantleRegion,
    preferences.groqApiKey,
    preferences.cerebrasApiKey,
  ]);

  const providerInfo = PROVIDER_INFO[selectedProvider];

  return (
    <div className="sidebar-container">
      {/* New Conversation Button - Icon only for cleaner look */}
      {onNewChat && (
        <Box padding={{ top: 's', horizontal: 's', bottom: 's' }}>
          <Button onClick={onNewChat} variant="primary" iconName="add-plus" fullWidth>
            New Conversation
          </Button>
        </Box>
      )}

      {/* Model Selection - Compact inline display */}
      <Box padding={{ horizontal: 's', bottom: 's' }}>
        <SpaceBetween size="xs">
          {/* Provider + Model in one line */}
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            <img
              src={providerInfo.icon}
              alt={providerInfo.iconAlt}
              style={{ width: '16px', height: '16px' }}
            />
            <Box variant="small" color="text-body-secondary">
              {providerInfo.shortLabel}
            </Box>
            {modelLoader.isLoading && (
              <Box variant="small" color="text-status-info">
                Loading... {modelLoader.progress.toFixed(0)}%
              </Box>
            )}
          </SpaceBetween>

          {/* Model Dropdown */}
          <Select
            selectedOption={selectedModel}
            onChange={({ detail }) => handleModelSelect(detail.selectedOption)}
            options={modelOptions}
            statusType={
              modelsLoadingStatus === 'error'
                ? 'error'
                : modelsLoadingStatus === 'loading' || modelLoader.isLoading
                  ? 'loading'
                  : 'finished'
            }
            loadingText={modelLoader.isLoading ? 'Loading model...' : 'Loading...'}
            errorText={modelErrorText}
            placeholder={modelsLoadingStatus === 'loading' ? 'Loading...' : 'Choose model'}
            filteringType="auto"
            ariaLabel="Model selection"
            disabled={modelsLoadingStatus === 'error' || modelLoader.isLoading}
            renderHighlightedAriaLive={(item) => item.label || ''}
            expandToViewport={true}
          />
        </SpaceBetween>
      </Box>

      {/* Divider */}
      <div className="sidebar-divider" />

      {/* Conversations Section - Primary focus */}
      <Box padding={{ horizontal: 's', top: 'xs' }}>
        <SpaceBetween size="xs">
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            <Icon name="contact" size="small" />
            <Box variant="small" color="text-body-secondary" fontWeight="bold">
              Conversations
            </Box>
          </SpaceBetween>
          {onNewChat && onSelectConversation && (
            <ConversationList
              activeConversationId={activeConversationId ?? null}
              onSelectConversation={onSelectConversation}
              onNewChat={onNewChat}
            />
          )}
        </SpaceBetween>
      </Box>

      {/* Divider before settings */}
      <div className="sidebar-divider" style={{ marginTop: 'auto' }} />

      {/* Preferences - with label for clarity */}
      <Box padding={{ horizontal: 's', vertical: 's' }}>
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <CollectionPreferences
            title="User Preferences"
            confirmLabel="Save"
            cancelLabel="Cancel"
            preferences={{ custom: preferences }}
            onConfirm={({ detail }) => handlePreferencesConfirm(detail)}
            customPreference={(customValue, setCustomValue) => (
              <SpaceBetween size="l">
                {/* Provider Selection Section */}
                <Box>
                  <SpaceBetween size="s">
                    <Box variant="h4">
                      <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                        <Icon name="share" size="small" />
                        <span>Model Provider</span>
                      </SpaceBetween>
                    </Box>
                    <RadioGroup
                      value={customValue.preferredProvider}
                      onChange={({ detail }) =>
                        setCustomValue({
                          ...customValue,
                          preferredProvider: detail.value as Provider,
                        })
                      }
                      items={[
                        {
                          value: 'bedrock',
                          label: (
                            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                              <img
                                src="/bedrock_bw.svg"
                                alt=""
                                style={{ width: '16px', height: '16px' }}
                              />
                              <span>Amazon Bedrock</span>
                            </SpaceBetween>
                          ),
                          description: 'AWS cloud AI models (uses AWS credentials)',
                        },
                        {
                          value: 'bedrock-mantle',
                          label: (
                            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                              <img
                                src="/bedrock-color.svg"
                                alt=""
                                style={{ width: '16px', height: '16px' }}
                              />
                              <span>Bedrock Mantle</span>
                            </SpaceBetween>
                          ),
                          description: 'OpenAI-compatible API (requires Bedrock API key)',
                        },
                        {
                          value: 'lmstudio',
                          label: (
                            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                              <img
                                src="/lmstudio_icon.svg"
                                alt=""
                                style={{ width: '16px', height: '16px' }}
                              />
                              <span>LM Studio</span>
                            </SpaceBetween>
                          ),
                          description: 'Local server on port 1234',
                        },
                        {
                          value: 'ollama',
                          label: (
                            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                              <img
                                src="/ollama_icon.svg"
                                alt=""
                                style={{ width: '16px', height: '16px' }}
                              />
                              <span>Ollama</span>
                            </SpaceBetween>
                          ),
                          description: 'Local server on port 11434',
                        },
                      ]}
                    />
                  </SpaceBetween>
                </Box>

                {/* Divider */}
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--color-border-divider-default)',
                    margin: '0',
                  }}
                />

                {/* Bedrock Mantle Settings */}
                <Box>
                  <SpaceBetween size="s">
                    <Box variant="h4">
                      <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                        <Icon name="key" size="small" />
                        <span>Bedrock Mantle Settings</span>
                      </SpaceBetween>
                    </Box>
                    <FormField
                      label="Bedrock API Key"
                      description="Your Amazon Bedrock API key"
                      stretch={true}
                    >
                      <Input
                        type="password"
                        value={customValue.bedrockMantleApiKey || ''}
                        onChange={({ detail }) =>
                          setCustomValue({
                            ...customValue,
                            bedrockMantleApiKey: detail.value,
                          })
                        }
                        placeholder="Enter your Bedrock API key"
                      />
                    </FormField>

                    <FormField
                      label="Region"
                      description="AWS region for Mantle endpoint"
                      stretch={true}
                    >
                      <Select
                        selectedOption={
                          MANTLE_REGIONS.find(
                            (r) => r.value === (customValue.bedrockMantleRegion || 'us-west-2')
                          ) || MANTLE_REGIONS[2]
                        }
                        onChange={({ detail }) =>
                          setCustomValue({
                            ...customValue,
                            bedrockMantleRegion: detail.selectedOption.value,
                          })
                        }
                        options={MANTLE_REGIONS}
                      />
                    </FormField>
                  </SpaceBetween>
                </Box>

                {/* Divider */}
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--color-border-divider-default)',
                    margin: '0',
                  }}
                />

                {/* AI SDK Provider Settings */}
                <Box>
                  <SpaceBetween size="s">
                    <Box variant="h4">
                      <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                        <Icon name="key" size="small" />
                        <span>AI Provider API Keys</span>
                      </SpaceBetween>
                    </Box>
                    <FormField
                      label="Groq API Key"
                      description="Get your key from console.groq.com"
                      stretch={true}
                    >
                      <Input
                        type="password"
                        value={customValue.groqApiKey || ''}
                        onChange={({ detail }) =>
                          setCustomValue({
                            ...customValue,
                            groqApiKey: detail.value,
                          })
                        }
                        placeholder="Enter your Groq API key"
                      />
                    </FormField>

                    <FormField
                      label="Cerebras API Key"
                      description="Get your key from cloud.cerebras.ai"
                      stretch={true}
                    >
                      <Input
                        type="password"
                        value={customValue.cerebrasApiKey || ''}
                        onChange={({ detail }) =>
                          setCustomValue({
                            ...customValue,
                            cerebrasApiKey: detail.value,
                          })
                        }
                        placeholder="Enter your Cerebras API key"
                      />
                    </FormField>
                  </SpaceBetween>
                </Box>

                {/* Divider */}
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--color-border-divider-default)',
                    margin: '0',
                  }}
                />

                {/* User Preferences Section */}
                <Box>
                  <SpaceBetween size="s">
                    <Box variant="h4">
                      <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                        <Icon name="user-profile" size="small" />
                        <span>Display Settings</span>
                      </SpaceBetween>
                    </Box>

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

                    <ColumnLayout columns={2}>
                      <FormField label="Visual Mode" stretch={true}>
                        <RadioGroup
                          value={customValue.visualMode}
                          onChange={({ detail }) =>
                            setCustomValue({
                              ...customValue,
                              visualMode: detail.value as VisualMode,
                            })
                          }
                          items={[
                            { value: 'light', label: 'Light' },
                            { value: 'dark', label: 'Dark' },
                          ]}
                        />
                      </FormField>

                      <FormField label="Content Density" stretch={true}>
                        <RadioGroup
                          value={customValue.contentDensity}
                          onChange={({ detail }) =>
                            setCustomValue({
                              ...customValue,
                              contentDensity: detail.value as ContentDensity,
                            })
                          }
                          items={[
                            { value: 'comfortable', label: 'Comfortable' },
                            { value: 'compact', label: 'Compact' },
                          ]}
                        />
                      </FormField>
                    </ColumnLayout>
                  </SpaceBetween>
                </Box>
              </SpaceBetween>
            )}
          />
          <Box variant="small" color="text-body-secondary">
            Preferences
          </Box>
        </SpaceBetween>
      </Box>

      {/* Model Loading Confirmation Modal */}
      {pendingModel && (
        <ModelLoadingConfirmModal
          visible={showLoadConfirm}
          modelName={pendingModel.label || pendingModel.value || 'Unknown Model'}
          onConfirm={handleConfirmLoad}
          onCancel={handleCancelLoad}
        />
      )}

      {/* Model Loading Progress Modal */}
      {pendingModel && (
        <ModelLoadingProgress
          visible={modelLoader.isLoading}
          modelName={pendingModel.label || pendingModel.value || 'Unknown Model'}
          onCancel={handleCancelProgress}
        />
      )}
    </div>
  );
}
