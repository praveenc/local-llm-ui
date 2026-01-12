'use client';

import {
  AlertTriangle,
  FileText,
  ImageIcon,
  Paperclip,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ModelOption } from '@/types';

type SamplingParameter = 'temperature' | 'topP';
type ChatStatus = 'idle' | 'streaming' | 'submitted';

interface AIChatInputMessage {
  text: string;
  files?: File[];
}

interface AIChatInputProps {
  onSubmit: (message: AIChatInputMessage) => void;
  status?: ChatStatus;
  selectedModel: ModelOption | null;
  // Model parameters
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  samplingParameter: SamplingParameter;
  setSamplingParameter: (param: SamplingParameter) => void;
  // Optional controlled input (for prompt optimization)
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  // Optional features
  showOptimizeButton?: boolean;
  onOptimizePrompt?: () => void;
  isOptimizing?: boolean;
  onStopGeneration?: () => void;
  onClearConversation?: () => void;
  hasMessages?: boolean;
  // Model status alert
  modelStatus?: {
    type: 'error' | 'warning' | 'info';
    header: string;
    content: string;
  } | null;
  onDismissModelStatus?: () => void;
}

// File type icons helper
const getFileIcon = (file: File) => {
  if (file.type.startsWith('image/')) {
    return <ImageIcon className="h-4 w-4" />;
  }
  return <FileText className="h-4 w-4" />;
};

// Attachment preview component
const AttachmentPreview = ({ file, onRemove }: { file: File; onRemove: () => void }) => {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pr-8">
      {preview ? (
        <img src={preview} alt={file.name} className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
          {getFileIcon(file)}
        </div>
      )}
      <div className="flex flex-col min-w-0">
        <span className="truncate text-sm font-medium max-w-[120px]">{file.name}</span>
        <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};

const AIChatInput = ({
  onSubmit,
  status = 'idle',
  selectedModel,
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature,
  topP,
  setTopP,
  samplingParameter,
  setSamplingParameter,
  inputValue: controlledInputValue,
  onInputValueChange,
  showOptimizeButton = false,
  onOptimizePrompt,
  isOptimizing = false,
  onStopGeneration,
  onClearConversation,
  hasMessages = false,
  modelStatus,
  onDismissModelStatus,
}: AIChatInputProps) => {
  const inputId = useId();
  const [internalInputValue, setInternalInputValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [clearModalVisible, setClearModalVisible] = useState(false);

  // Support controlled and uncontrolled modes
  const isControlled = controlledInputValue !== undefined;
  const inputValue = isControlled ? controlledInputValue : internalInputValue;
  const setInputValue = isControlled
    ? (value: string) => onInputValueChange?.(value)
    : setInternalInputValue;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoading = status === 'streaming' || status === 'submitted';
  const isBedrockModel = selectedModel?.description?.toLowerCase().includes('bedrock') ?? false;
  const isMantleModel =
    selectedModel?.description?.toLowerCase().includes('bedrock-mantle') ?? false;

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

  // Provider info for display
  const getProviderInfo = () => {
    if (isMantleModel) return { icon: '/bedrock-color.svg', name: 'Mantle' };
    if (isBedrockModel) return { icon: '/bedrock_bw.svg', name: 'Bedrock' };
    if (selectedModel?.description?.toLowerCase().includes('lmstudio'))
      return { icon: '/lmstudio_icon.svg', name: 'LM Studio' };
    if (selectedModel?.description?.toLowerCase().includes('ollama'))
      return { icon: '/ollama_icon.svg', name: 'Ollama' };
    if (selectedModel?.description?.toLowerCase().includes('groq'))
      return { icon: '/groq_icon.svg', name: 'Groq' };
    if (selectedModel?.description?.toLowerCase().includes('cerebras'))
      return { icon: '/cerebras_icon.svg', name: 'Cerebras' };
    return null;
  };

  const providerInfo = getProviderInfo();
  const supportsAttachments = isBedrockModel || isMantleModel;

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 24;
    const minHeight = lineHeight * 2;
    const maxHeight = lineHeight * 8;
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [inputValue, adjustHeight]);

  // File handling
  const handleAddFiles = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleAddFiles(Array.from(e.target.files));
      e.target.value = ''; // Reset input
    }
  };

  // Drag and drop
  const handleDragOver = (e: DragEvent) => {
    if (!supportsAttachments) return;
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
    if (supportsAttachments && e.dataTransfer.files) {
      handleAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Submit handling
  const handleSubmit = () => {
    const hasText = inputValue.trim().length > 0;
    const hasFiles = files.length > 0;

    if (!selectedModel || isLoading || !(hasText || hasFiles)) return;

    onSubmit({
      text: inputValue.trim(),
      files: files.length > 0 ? files : undefined,
    });

    // Clear internal state (controlled mode will be handled by parent)
    if (!isControlled) {
      setInternalInputValue('');
    }
    setFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = selectedModel && !isLoading && (inputValue.trim() || files.length > 0);

  return (
    <TooltipProvider>
      {/* Model Status Alert */}
      {modelStatus && (
        <div className="absolute bottom-40 left-0 right-0 z-[999] px-2 md:px-4">
          <div className="max-w-4xl mx-auto">
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

      {/* Main Input Container */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[1000] p-2 md:p-4"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={cn(
            'max-w-4xl mx-auto',
            'bg-background/95 backdrop-blur-md',
            'border border-border rounded-xl shadow-lg',
            'overflow-hidden transition-all',
            isDragging && 'ring-2 ring-primary ring-offset-2'
          )}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-primary/10 flex items-center justify-center z-10 rounded-xl">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Paperclip className="h-8 w-8" />
                <span className="text-sm font-medium">Drop files here</span>
              </div>
            </div>
          )}

          {/* Attachments Header */}
          {files.length > 0 && (
            <div className="px-3 pt-3 pb-2 border-b border-border">
              <div className="flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <AttachmentPreview
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() => handleRemoveFile(index)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Input Body */}
          <div className="p-3 max-h-[240px] overflow-hidden">
            <textarea
              ref={textareaRef}
              id={inputId}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedModel ? 'Send a message...' : 'Select a model to start chatting'}
              disabled={isLoading || !selectedModel}
              className={cn(
                'w-full resize-none bg-transparent',
                'text-sm placeholder:text-muted-foreground',
                'focus:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'min-h-[48px] max-h-[192px] overflow-y-auto',
                'whitespace-pre-wrap break-words'
              )}
              rows={2}
            />
          </div>

          {/* Footer with Tools */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Left side tools */}
            <div className="flex items-center gap-1">
              {/* Attachment Menu */}
              {supportsAttachments && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                      <Paperclip className="h-4 w-4 mr-2" />
                      Add attachments
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
                accept=".pdf,.txt,.html,.md,.csv,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
              />

              {/* Optimize prompt button */}
              {showOptimizeButton && onOptimizePrompt && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary"
                      onClick={onOptimizePrompt}
                      disabled={!inputValue.trim() || isOptimizing || isLoading}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Optimize prompt with AI</TooltipContent>
                </Tooltip>
              )}

              {/* Clear conversation */}
              {hasMessages && onClearConversation && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setClearModalVisible(true)}
                      disabled={isLoading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear conversation</TooltipContent>
                </Tooltip>
              )}

              {/* Settings */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setSettingsVisible(true)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Model parameters</TooltipContent>
              </Tooltip>

              {/* Model indicator */}
              {selectedModel && providerInfo && (
                <div className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded-md bg-muted/50">
                  <img src={providerInfo.icon} alt={providerInfo.name} className="w-4 h-4" />
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                    {selectedModel.label}
                  </span>
                </div>
              )}
            </div>

            {/* Right side - Submit/Stop */}
            <div className="flex items-center gap-2">
              {isLoading && onStopGeneration ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onStopGeneration}
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
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
                    <RadioGroupItem value="temperature" id="temp-radio" />
                    <Label htmlFor="temp-radio">Temperature</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="topP" id="topp-radio" />
                    <Label htmlFor="topp-radio">Top P</Label>
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

      {/* Clear Conversation Dialog */}
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

export default AIChatInput;
