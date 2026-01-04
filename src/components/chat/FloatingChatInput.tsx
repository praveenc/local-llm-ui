import {
  AlertTriangle,
  Download,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SelectProps } from '@cloudscape-design/components';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
  onSavePrompt?: (content: string) => void;
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
  onSavePrompt,
}: FloatingChatInputProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 24;
    const minHeight = lineHeight * 3; // 3 lines minimum
    const maxHeight = lineHeight * 8; // 8 lines maximum
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [inputValue, adjustHeight]);

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
      textareaRef.current?.focus();
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileChange(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileChange(Array.from(e.dataTransfer.files));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && selectedModel && inputValue.trim()) {
        onSendMessage();
      }
    }
  };

  const handleSend = () => {
    if (!isLoading && selectedModel && inputValue.trim()) {
      onSendMessage();
    }
  };

  return (
    <TooltipProvider>
      {/* Model Status Alert - positioned above input */}
      {modelStatus && (
        <div className="fixed bottom-36 left-0 md:left-[280px] right-0 z-[999] px-4 md:px-8 pointer-events-none">
          <div className="max-w-[1100px] mx-auto pointer-events-auto">
            <Alert
              variant={modelStatus.type === 'error' ? 'destructive' : 'default'}
              className="relative"
            >
              <AlertTitle>{modelStatus.header}</AlertTitle>
              <AlertDescription>{modelStatus.content}</AlertDescription>
              {onDismissModelStatus && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6"
                  onClick={onDismissModelStatus}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </Alert>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 md:left-[280px] right-0 z-[1000] p-2 md:p-4 pointer-events-none">
        <div
          className={cn(
            'max-w-[1100px] mx-auto pointer-events-auto',
            'bg-background/92 backdrop-blur-md',
            'border border-border rounded-lg shadow-lg',
            'overflow-hidden'
          )}
          onDragOver={isBedrockModel ? handleDragOver : undefined}
          onDragLeave={isBedrockModel ? handleDragLeave : undefined}
          onDrop={isBedrockModel ? handleDrop : undefined}
        >
          {/* Compact header bar */}
          {selectedModel && (
            <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {providerInfo && (
                  <>
                    <img
                      src={providerInfo.icon}
                      alt={providerInfo.name}
                      className="w-4 h-4 flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {selectedModel.label}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {showOptimizeButton && onOptimizePrompt && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary"
                        onClick={onOptimizePrompt}
                        disabled={!inputValue.trim() || isOptimizing || isLoading}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Optimize prompt with AI</TooltipContent>
                  </Tooltip>
                )}
                {onSavePrompt && inputValue.trim() && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onSavePrompt(inputValue)}
                        disabled={isLoading}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Save prompt for later</TooltipContent>
                  </Tooltip>
                )}
                {hasMessages && onClearConversation && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setClearModalVisible(true)}
                        disabled={isLoading}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear conversation</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSettingsVisible(true)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Model parameters</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className={cn('p-3', selectedModel ? 'pt-2' : '')}>
            {/* Drag and drop overlay */}
            {isBedrockModel && isDragging && (
              <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2 text-primary">
                  <Upload className="h-8 w-8" />
                  <span className="text-sm font-medium">Drop files here</span>
                </div>
              </div>
            )}

            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => onInputValueChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedModel ? 'Send a message...' : 'Select a model to start chatting'
                }
                disabled={isLoading || !selectedModel}
                className={cn(
                  'min-h-[72px] resize-none pr-24',
                  'focus-visible:ring-1 focus-visible:ring-ring'
                )}
                rows={3}
              />

              {/* Action buttons inside textarea */}
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                {isBedrockModel && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                      accept=".pdf,.txt,.html,.md,.csv,.doc,.docx,.xls,.xlsx"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Attach files</TooltipContent>
                    </Tooltip>
                  </>
                )}
                {isLMStudioModel && isLoading && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={onStopGeneration}
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop generation</TooltipContent>
                  </Tooltip>
                )}
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSend}
                  disabled={isLoading || !selectedModel || !inputValue.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* File tokens */}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.slice(0, 3).map((file, index) => (
                  <Badge key={index} variant="secondary" className="gap-1 pr-1">
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 ml-1 hover:bg-transparent"
                      onClick={() => handleFileDismiss(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
                {files.length > 3 && <Badge variant="outline">+{files.length - 3} more</Badge>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={settingsVisible} onOpenChange={setSettingsVisible}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Model Parameters</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-6 py-4">
            <div className="space-y-3">
              <Label>Max Tokens: {maxTokens.toLocaleString()}</Label>
              <Slider
                value={[maxTokens]}
                onValueChange={(values: number[]) => setMaxTokens(values[0])}
                min={1024}
                max={10240}
                step={1024}
              />
            </div>

            {isClaude45Model && (
              <div className="space-y-3">
                <Label>Sampling Parameter</Label>
                <p className="text-sm text-muted-foreground">
                  Claude 4.5 models support either temperature or topP, but not both
                </p>
                <RadioGroup
                  value={samplingParameter}
                  onValueChange={(value) => setSamplingParameter(value as SamplingParameter)}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="temperature" id="temperature" />
                    <Label htmlFor="temperature">Temperature</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="topP" id="topP" />
                    <Label htmlFor="topP">Top P</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="space-y-3">
              <Label>
                Temperature:{' '}
                {isClaude45Model && samplingParameter !== 'temperature'
                  ? 'N/A'
                  : temperature.toFixed(1)}
              </Label>
              <Slider
                value={[temperature]}
                onValueChange={(values: number[]) => setTemperature(values[0])}
                min={0}
                max={1}
                step={0.1}
                disabled={isClaude45Model && samplingParameter !== 'temperature'}
              />
            </div>

            <div className="space-y-3">
              <Label>
                Top P: {isClaude45Model && samplingParameter !== 'topP' ? 'N/A' : topP.toFixed(1)}
              </Label>
              <Slider
                value={[topP]}
                onValueChange={(values: number[]) => setTopP(values[0])}
                min={0}
                max={1}
                step={0.1}
                disabled={isClaude45Model && samplingParameter !== 'topP'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsVisible(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Conversation Confirmation Dialog */}
      <Dialog open={clearModalVisible} onOpenChange={setClearModalVisible}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear conversation</DialogTitle>
            <DialogDescription>Are you sure you want to clear this conversation?</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <span>This action is irreversible. All messages will be permanently deleted.</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearModalVisible(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onClearConversation?.();
                setClearModalVisible(false);
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

export default FloatingChatInput;
