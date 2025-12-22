import { useEffect, useRef, useState } from 'react';

import {
  Box,
  Button,
  FileDropzone,
  FileInput,
  FileTokenGroup,
  Flashbar,
  FormField,
  Icon,
  Modal,
  PromptInput,
  RadioGroup,
  Slider,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { FlashbarProps, SelectProps } from '@cloudscape-design/components';

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
  showOptimizeButton?: boolean;
  onOptimizePrompt?: () => void;
  isOptimizing?: boolean;
  modelStatus?: {
    type: 'error' | 'warning' | 'info';
    header: string;
    content: string;
  } | null;
  onDismissModelStatus?: () => void;
  onClearConversation?: () => void;
  hasMessages?: boolean;
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
  showOptimizeButton = false,
  onOptimizePrompt,
  isOptimizing = false,
  modelStatus,
  onDismissModelStatus,
  onClearConversation,
  hasMessages = false,
}: FloatingChatInputProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const { areFilesDragging } = useFilesDragging();
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [clearModalVisible, setClearModalVisible] = useState<boolean>(false);

  const isBedrockModel = selectedModel?.description?.toLowerCase().includes('bedrock') ?? false;
  const isMantleModel =
    selectedModel?.description?.toLowerCase().includes('bedrock-mantle') ?? false;
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

  // Determine provider icon and name
  const getProviderInfo = () => {
    if (isMantleModel) return { icon: '/bedrock-color.svg', name: 'Mantle' };
    if (isBedrockModel) return { icon: '/bedrock_bw.svg', name: 'Bedrock' };
    if (isLMStudioModel) return { icon: '/lmstudio_icon.svg', name: 'LM Studio' };
    if (isOllamaModel) return { icon: '/ollama_icon.svg', name: 'Ollama' };
    return null;
  };

  const providerInfo = getProviderInfo();

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
      {/* Model Status Flashbar - positioned above input */}
      {modelStatus && (
        <div className="model-status-flashbar">
          <Flashbar
            items={[
              {
                type: modelStatus.type as FlashbarProps.Type,
                header: modelStatus.header,
                content: modelStatus.content,
                dismissible: true,
                onDismiss: onDismissModelStatus,
                id: 'model-status',
              },
            ]}
          />
        </div>
      )}

      <div className="floating-chat-input">
        <div className="floating-chat-input__container">
          {/* Compact header bar */}
          {selectedModel && (
            <div className="floating-chat-input__header">
              <div className="floating-chat-input__model-info">
                {providerInfo && (
                  <>
                    <img
                      src={providerInfo.icon}
                      alt={providerInfo.name}
                      className="floating-chat-input__provider-icon"
                    />
                    <span className="floating-chat-input__model-name">{selectedModel.label}</span>
                  </>
                )}
              </div>
              <div className="floating-chat-input__actions">
                {showOptimizeButton && onOptimizePrompt && (
                  <button
                    className="floating-chat-input__action-btn floating-chat-input__action-btn--optimize"
                    onClick={onOptimizePrompt}
                    disabled={!inputValue.trim() || isOptimizing || isLoading}
                    aria-label="Optimize prompt"
                    title="Optimize prompt with AI"
                  >
                    <Icon name="gen-ai" size="small" />
                  </button>
                )}
                {hasMessages && onClearConversation && (
                  <button
                    className="floating-chat-input__action-btn"
                    onClick={() => setClearModalVisible(true)}
                    disabled={isLoading}
                    aria-label="Clear conversation"
                    title="Clear conversation"
                  >
                    <Icon name="remove" size="small" />
                  </button>
                )}
                <button
                  className="floating-chat-input__action-btn"
                  onClick={() => setSettingsVisible(true)}
                  aria-label="Model settings"
                  title="Model parameters"
                >
                  <Icon name="settings" size="small" />
                </button>
              </div>
            </div>
          )}

          {/* Input area */}
          <Box padding={{ horizontal: 'm', bottom: 'm', top: selectedModel ? 'xs' : 'm' }}>
            <PromptInput
              ref={promptInputRef}
              value={inputValue}
              onChange={({ detail }) => onInputValueChange(detail.value)}
              onAction={onSendMessage}
              placeholder={selectedModel ? 'Send a message...' : 'Select a model to start chatting'}
              disabled={isLoading || !selectedModel}
              actionButtonAriaLabel={
                isLoading ? 'Send message button - suppressed' : 'Send message'
              }
              actionButtonIconName="send"
              ariaLabel={isLoading ? 'Prompt input - suppressed' : 'Chat input'}
              maxRows={6}
              minRows={2}
              disableSecondaryActionsPaddings
              secondaryActions={
                <SpaceBetween direction="horizontal" size="xxs">
                  {isBedrockModel && (
                    <Box padding={{ left: 'xxs', top: 'xs' }}>
                      <FileInput
                        ariaLabel="Upload files"
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
                        iconName="close"
                        ariaLabel="Stop generation"
                        onClick={onStopGeneration}
                      />
                    </Box>
                  )}
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
                      <FileTokenGroup
                        items={files.map((file) => ({ file }))}
                        onDismiss={({ detail }) => handleFileDismiss(detail.fileIndex)}
                        limit={3}
                        alignment="horizontal"
                        showFileThumbnail={true}
                        i18nStrings={fileTokenGroupI18nStrings}
                      />
                    )
                  )}
                </>
              }
            />
          </Box>
        </div>
      </div>

      {/* Settings Modal */}
      <Modal
        onDismiss={() => setSettingsVisible(false)}
        visible={settingsVisible}
        size="medium"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setSettingsVisible(false)}>
              Done
            </Button>
          </Box>
        }
        header="Model Parameters"
      >
        <SpaceBetween size="l">
          <FormField label={`Max Tokens: ${maxTokens.toLocaleString()}`}>
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
              label="Sampling Parameter"
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
            label={`Temperature: ${isClaude45Model && samplingParameter !== 'temperature' ? 'N/A' : temperature.toFixed(1)}`}
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
            label={`Top P: ${isClaude45Model && samplingParameter !== 'topP' ? 'N/A' : topP.toFixed(1)}`}
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

      {/* Clear Conversation Confirmation Modal */}
      <Modal
        onDismiss={() => setClearModalVisible(false)}
        visible={clearModalVisible}
        size="small"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setClearModalVisible(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onClearConversation?.();
                  setClearModalVisible(false);
                }}
              >
                Clear
              </Button>
            </SpaceBetween>
          </Box>
        }
        header="Clear conversation"
      >
        <SpaceBetween size="s">
          <Box>Are you sure you want to clear this conversation?</Box>
          <Box color="text-status-warning" variant="small">
            <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
              <Icon name="status-warning" size="small" />
              <span>This action is irreversible. All messages will be permanently deleted.</span>
            </SpaceBetween>
          </Box>
        </SpaceBetween>
      </Modal>
    </>
  );
};

export default FloatingChatInput;
