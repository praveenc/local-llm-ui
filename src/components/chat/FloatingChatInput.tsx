import { useEffect, useRef, useState } from 'react';

import {
  Badge,
  Box,
  Button,
  ExpandableSection,
  FileDropzone,
  FileInput,
  FileTokenGroup,
  FormField,
  Icon,
  KeyValuePairs,
  Modal,
  PromptInput,
  RadioGroup,
  Slider,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import useFilesDragging from '../../hooks/useFilesDragging';
import '../../styles/FloatingChatInput.scss';
import { fileTokenGroupI18nStrings } from '../../utils/i18nStrings';

type SamplingParameter = 'temperature' | 'topP';

interface FloatingChatInputProps {
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onSendMessage: () => void;
  onStopGeneration: () => void;
  isLoading: boolean;
  selectedModel: SelectProps.Option | null;
  onFilesChange?: (files: File[]) => void;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  samplingParameter: SamplingParameter;
  setSamplingParameter: (param: SamplingParameter) => void;
  bedrockMetadata?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  } | null;
  lmstudioMetadata?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
}

const FloatingChatInput = ({
  inputValue,
  onInputValueChange,
  onSendMessage,
  onStopGeneration,
  isLoading,
  selectedModel,
  onFilesChange = () => {},
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature,
  topP,
  setTopP,
  samplingParameter,
  setSamplingParameter,
  bedrockMetadata,
  lmstudioMetadata,
}: FloatingChatInputProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const { areFilesDragging } = useFilesDragging();
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);

  const isBedrockModel = selectedModel?.description?.toLowerCase().includes('bedrock') ?? false;
  const isLMStudioModel = selectedModel?.description?.toLowerCase().includes('lmstudio') ?? false;
  const isOllamaModel = selectedModel?.description?.toLowerCase().includes('ollama') ?? false;

  // Claude 4.5 models don't support both temperature and topP simultaneously
  const modelId = selectedModel?.value?.toLowerCase() ?? '';
  const isClaude45Model =
    modelId.includes('sonnet-4-5') || modelId.includes('haiku-4-5') || modelId.includes('opus-4-5');

  // Reset to temperature when switching away from Claude 4.5 models
  useEffect(() => {
    if (!isClaude45Model) {
      setSamplingParameter('temperature');
    }
  }, [isClaude45Model, setSamplingParameter]);

  // Determine provider icon to show
  const providerIcon = isBedrockModel
    ? '/bedrock_bw.svg'
    : isLMStudioModel
      ? '/lmstudio_icon.svg'
      : isOllamaModel
        ? '/ollama_icon.svg'
        : null;

  const handleFileChange = (newFiles: File[]) => {
    setFiles((prev) => {
      const updatedFiles = [...prev, ...newFiles];
      onFilesChange(updatedFiles);
      return updatedFiles;
    });
  };

  const handleFileDismiss = (fileIndex: number) => {
    setFiles((files) => {
      const updatedFiles = files.filter((_, index) => index !== fileIndex);
      onFilesChange(updatedFiles);
      return updatedFiles;
    });

    if (files.length === 1) {
      promptInputRef.current?.focus();
    }
  };

  return (
    <>
      <div className="floating-chat-input">
        <Box padding={{ horizontal: 'l', vertical: 'm' }}>
          <SpaceBetween size="s">
            {/* Model Badge and Usage Metrics */}
            {selectedModel && (
              <SpaceBetween size="xs">
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  {/* Provider Icon */}
                  {providerIcon && (
                    <img
                      src={providerIcon}
                      alt={
                        isBedrockModel ? 'Amazon Bedrock' : isLMStudioModel ? 'LM Studio' : 'Ollama'
                      }
                      style={{ width: '20px', height: '20px' }}
                    />
                  )}
                  <Badge color="blue">{selectedModel.label}</Badge>
                  <SpaceBetween direction="horizontal" size="l">
                    <Box fontSize="body-s" color="text-body-secondary">
                      🌡️ Temperature:{' '}
                      <strong>
                        {isClaude45Model && samplingParameter !== 'temperature'
                          ? 'N/A'
                          : temperature.toFixed(1)}
                      </strong>
                    </Box>
                    <Box fontSize="body-s" color="text-body-secondary">
                      🎯 Top P:{' '}
                      <strong>
                        {isClaude45Model && samplingParameter !== 'topP' ? 'N/A' : topP.toFixed(1)}
                      </strong>
                    </Box>
                    <Box fontSize="body-s" color="text-body-secondary">
                      📊 Max Tokens: <strong>{maxTokens.toLocaleString()}</strong>
                    </Box>
                  </SpaceBetween>
                </SpaceBetween>

                {/* Bedrock Usage Metrics */}
                {bedrockMetadata &&
                  selectedModel?.description?.toLowerCase().includes('bedrock') && (
                    <ExpandableSection
                      variant="footer"
                      headerText={
                        <Box fontSize="body-s">
                          <SpaceBetween direction="horizontal" size="xs">
                            <span>📈 Usage</span>
                            <Badge color="green">
                              {bedrockMetadata.totalTokens?.toLocaleString() || 0} tokens
                            </Badge>
                          </SpaceBetween>
                        </Box>
                      }
                    >
                      <Box padding={{ top: 'xs' }}>
                        <KeyValuePairs
                          columns={4}
                          items={[
                            {
                              label: '⬇️ Input',
                              value: bedrockMetadata.inputTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '⬆️ Output',
                              value: bedrockMetadata.outputTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '💎 Total',
                              value: bedrockMetadata.totalTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '⚡ Latency',
                              value: bedrockMetadata.latencyMs
                                ? `${bedrockMetadata.latencyMs}ms`
                                : 'N/A',
                            },
                          ]}
                        />
                      </Box>
                    </ExpandableSection>
                  )}

                {/* LM Studio Usage Metrics */}
                {lmstudioMetadata &&
                  selectedModel?.description?.toLowerCase().includes('lmstudio') && (
                    <ExpandableSection
                      variant="footer"
                      headerText={
                        <Box fontSize="body-s">
                          <SpaceBetween direction="horizontal" size="xs">
                            <span>📈 Usage</span>
                            <Badge color="blue">
                              {lmstudioMetadata.totalTokens?.toLocaleString() || 0} tokens
                            </Badge>
                          </SpaceBetween>
                        </Box>
                      }
                    >
                      <Box padding={{ top: 'xs' }}>
                        <KeyValuePairs
                          columns={3}
                          items={[
                            {
                              label: '⬇️ Prompt',
                              value: lmstudioMetadata.promptTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '⬆️ Completion',
                              value: lmstudioMetadata.completionTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '💎 Total',
                              value: lmstudioMetadata.totalTokens?.toLocaleString() || '0',
                            },
                          ]}
                        />
                      </Box>
                    </ExpandableSection>
                  )}
              </SpaceBetween>
            )}

            {/* Input Field */}
            <FormField
              stretch={true}
              description={
                isBedrockModel && files.length === 0
                  ? '💡 Tip: Upload documents (PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX) up to 4.5 MB'
                  : undefined
              }
            >
              <PromptInput
                ref={promptInputRef}
                value={inputValue}
                onChange={({ detail }) => onInputValueChange(detail.value)}
                onAction={onSendMessage}
                placeholder={
                  selectedModel ? 'Send a message...' : 'Select a model to start chatting'
                }
                disabled={isLoading || !selectedModel}
                actionButtonAriaLabel={
                  isLoading ? 'Send message button - suppressed' : 'Send message'
                }
                actionButtonIconName="send"
                ariaLabel={isLoading ? 'Prompt input - suppressed' : 'Chat input'}
                maxRows={8}
                minRows={3}
                disableSecondaryActionsPaddings
                secondaryActions={
                  <SpaceBetween direction="horizontal" size="xs">
                    {isBedrockModel && (
                      <Box padding={{ left: 'xxs', top: 'xs' }}>
                        <FileInput
                          ariaLabel="Chat file input - Max 4.5MB per file"
                          variant="icon"
                          multiple={true}
                          value={files}
                          onChange={({ detail }) => handleFileChange(detail.value)}
                        />
                      </Box>
                    )}
                    {isLMStudioModel && isLoading && (
                      <Box padding={{ top: 'xs' }}>
                        <Button
                          variant="icon"
                          iconName="stop-circle"
                          ariaLabel="Stop generation"
                          onClick={onStopGeneration}
                        />
                      </Box>
                    )}
                    <Box padding={{ top: 'xs' }}>
                      <Button
                        variant="icon"
                        iconName="settings"
                        ariaLabel="Model settings"
                        onClick={() => setSettingsVisible(true)}
                      />
                    </Box>
                  </SpaceBetween>
                }
                secondaryContent={
                  <>
                    {isBedrockModel && areFilesDragging ? (
                      <FileDropzone onChange={({ detail }) => handleFileChange(detail.value)}>
                        <SpaceBetween size="xs" alignItems="center">
                          <Icon name="upload" />
                          <Box>Drop files here</Box>
                        </SpaceBetween>
                      </FileDropzone>
                    ) : (
                      files.length > 0 && (
                        <SpaceBetween size="xs">
                          <FileTokenGroup
                            items={files.map((file) => ({ file }))}
                            onDismiss={({ detail }) => handleFileDismiss(detail.fileIndex)}
                            limit={3}
                            alignment="horizontal"
                            showFileThumbnail={true}
                            i18nStrings={fileTokenGroupI18nStrings}
                          />
                          {isBedrockModel && (
                            <Box fontSize="body-s" color="text-body-secondary">
                              📎 Max 5 files, 4.5 MB each
                            </Box>
                          )}
                        </SpaceBetween>
                      )
                    )}
                  </>
                }
              />
            </FormField>
          </SpaceBetween>
        </Box>
      </div>

      {/* Settings Modal */}
      <Modal
        onDismiss={() => setSettingsVisible(false)}
        visible={settingsVisible}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setSettingsVisible(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setSettingsVisible(false)}>
                OK
              </Button>
            </SpaceBetween>
          </Box>
        }
        header="⚙️ Model Parameters"
      >
        <SpaceBetween size="l">
          <FormField label={`📊 Max Tokens: ${maxTokens.toLocaleString()}`}>
            <Slider
              onChange={({ detail }) => setMaxTokens(detail.value)}
              value={maxTokens}
              min={1024}
              max={10240}
              step={1024}
              ariaLabel="Max Tokens Slider"
            />
          </FormField>

          {isClaude45Model && (
            <FormField
              label="🔀 Sampling Parameter"
              description="Claude 4.5 models support either temperature or topP, but not both"
            >
              <RadioGroup
                value={samplingParameter}
                onChange={({ detail }) => setSamplingParameter(detail.value as SamplingParameter)}
                items={[
                  { value: 'temperature', label: 'Temperature' },
                  { value: 'topP', label: 'Top P' },
                ]}
              />
            </FormField>
          )}

          <FormField
            label={`🌡️ Temperature: ${isClaude45Model && samplingParameter !== 'temperature' ? 'N/A' : temperature.toFixed(1)}`}
          >
            <Slider
              onChange={({ detail }) => setTemperature(detail.value)}
              value={temperature}
              min={0}
              max={1.0}
              step={0.1}
              ariaLabel="Temperature Slider"
              disabled={isClaude45Model && samplingParameter !== 'temperature'}
            />
          </FormField>

          <FormField
            label={`🎯 Top P: ${isClaude45Model && samplingParameter !== 'topP' ? 'N/A' : topP.toFixed(1)}`}
          >
            <Slider
              onChange={({ detail }) => setTopP(detail.value)}
              value={topP}
              min={0}
              max={1.0}
              step={0.1}
              ariaLabel="Top P Slider"
              disabled={isClaude45Model && samplingParameter !== 'topP'}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
};

export default FloatingChatInput;
