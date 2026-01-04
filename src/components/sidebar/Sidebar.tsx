import { FileText, Loader2, MessageSquare, Plus, Settings } from 'lucide-react';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import { useModelLoader } from '../../hooks';
import { useProviderModels } from '../../hooks/useProviderModels';
import type { ModelGroup, ModelOption } from '../../hooks/useProviderModels';
import { loadPreferences } from '../../utils/preferences';
import type { Provider, UserPreferences } from '../../utils/preferences';
import { ViewPromptsModal } from '../prompts';
import { ConversationList } from './ConversationList';
import { ModelSelect } from './ModelSelect';
import { PreferencesDialog } from './PreferencesDialog';
import { ProviderSelect } from './ProviderSelect';

interface SidebarProps {
  selectedModel: { value: string; label: string } | null;
  setSelectedModel: (model: { value: string; label: string } | null) => void;
  onNewChat?: () => void;
  onPreferencesChange?: (preferences: UserPreferences) => void;
  onPreferencesSaved?: () => void;
  selectedProvider: Provider;
  onProviderChange: (provider: Provider) => void;
  onModelLoadError?: (error: { title: string; content: string }) => void;
  onModelLoadSuccess?: (modelName: string) => void;
  onModelStatusChange?: (
    status: { type: 'error' | 'warning' | 'info'; header: string; content: string } | null
  ) => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export function Sidebar({
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
}: SidebarProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [loadConfirmOpen, setLoadConfirmOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<{ value: string; label: string } | null>(null);

  const modelLoader = useModelLoader();
  const { models, status, error } = useProviderModels(selectedProvider, preferences);

  // Auto-select first model when models load
  useEffect(() => {
    if (status === 'finished' && models.length > 0 && !selectedModel) {
      const firstModel = getFirstModel(models);
      if (firstModel) {
        if (selectedProvider === 'lmstudio') {
          setPendingModel(firstModel);
          setLoadConfirmOpen(true);
        } else {
          setSelectedModel(firstModel);
        }
      }
    }
  }, [status, models, selectedModel, selectedProvider, setSelectedModel]);

  // Notify parent of model status changes
  useEffect(() => {
    if (error) {
      onModelStatusChange?.({
        type: 'warning',
        header: `${selectedProvider} connection failed`,
        content: error,
      });
    } else if (status === 'finished' && models.length === 0) {
      onModelStatusChange?.({
        type: 'info',
        header: 'No models available',
        content: getEmptyModelsMessage(selectedProvider),
      });
    } else {
      onModelStatusChange?.(null);
    }
  }, [error, status, models.length, selectedProvider, onModelStatusChange]);

  const getFirstModel = (
    items: (ModelOption | ModelGroup)[]
  ): { value: string; label: string } | null => {
    for (const item of items) {
      if ('options' in item && item.options.length > 0) {
        return { value: item.options[0].value, label: item.options[0].label };
      } else if ('value' in item) {
        return { value: item.value, label: item.label };
      }
    }
    return null;
  };

  const getEmptyModelsMessage = (provider: Provider): string => {
    const messages: Record<Provider, string> = {
      lmstudio: 'Load a model in LM Studio or enable JIT Loading.',
      ollama: 'Pull a model using: ollama pull llama2',
      bedrock: 'Check AWS credentials and IAM permissions.',
      'bedrock-mantle': 'Check your Bedrock API key.',
      groq: 'Check your Groq API key.',
      cerebras: 'Check your Cerebras API key.',
    };
    return messages[provider];
  };

  const handleModelSelect = (value: string, label: string) => {
    if (selectedProvider === 'lmstudio') {
      setPendingModel({ value, label });
      setLoadConfirmOpen(true);
    } else {
      setSelectedModel({ value, label });
    }
  };

  const handleConfirmLoad = async () => {
    if (!pendingModel) return;
    setLoadConfirmOpen(false);

    try {
      const result = await modelLoader.loadModel(pendingModel.value);
      if (result.success) {
        setSelectedModel(pendingModel);
        onModelLoadSuccess?.(pendingModel.label);
      } else if (result.error) {
        onModelLoadError?.({ title: 'Failed to load model', content: result.error });
      }
    } catch (err) {
      const error = err as Error;
      onModelLoadError?.({ title: 'Failed to load model', content: error.message });
    } finally {
      setPendingModel(null);
      modelLoader.reset();
    }
  };

  const handleProviderChange = (provider: Provider) => {
    setSelectedModel(null);
    onProviderChange(provider);
  };

  const handlePreferencesSave = (newPrefs: UserPreferences) => {
    setPreferences(newPrefs);
    if (newPrefs.preferredProvider !== selectedProvider) {
      setSelectedModel(null);
      onProviderChange(newPrefs.preferredProvider);
    }
    onPreferencesChange?.(newPrefs);
    onPreferencesSaved?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* New Conversation Button */}
      <div className="p-3">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="default">
          <Plus className="h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <Separator />

      {/* Provider & Model Selection */}
      <div className="p-3 space-y-2">
        <ProviderSelect
          value={selectedProvider}
          onValueChange={handleProviderChange}
          disabled={modelLoader.isLoading}
        />
        <ModelSelect
          models={models}
          value={selectedModel?.value ?? null}
          onValueChange={handleModelSelect}
          isLoading={status === 'loading' || modelLoader.isLoading}
          error={error}
          disabled={modelLoader.isLoading}
        />
        {modelLoader.isLoading && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Loading model... {modelLoader.progress.toFixed(0)}%</span>
            </div>
            <Progress value={modelLoader.progress} className="h-1" />
          </div>
        )}
      </div>

      <Separator />

      {/* Conversations */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <MessageSquare className="h-3 w-3" />
            Conversations
          </div>
        </div>
        <ScrollArea className="flex-1">
          {onNewChat && onSelectConversation && (
            <ConversationList
              activeConversationId={activeConversationId ?? null}
              onSelectConversation={onSelectConversation}
              onNewChat={onNewChat}
            />
          )}
        </ScrollArea>
      </div>

      <Separator />

      {/* Footer Actions */}
      <div className="p-2 space-y-1">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9"
          onClick={() => setPromptsOpen(true)}
        >
          <FileText className="h-4 w-4" />
          Saved Prompts
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9"
          onClick={() => setPreferencesOpen(true)}
        >
          <Settings className="h-4 w-4" />
          Preferences
        </Button>
      </div>

      {/* Modals */}
      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        onSave={handlePreferencesSave}
      />

      <ViewPromptsModal visible={promptsOpen} onDismiss={() => setPromptsOpen(false)} />

      {/* LM Studio Load Confirmation */}
      <Dialog open={loadConfirmOpen} onOpenChange={setLoadConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Load Model</DialogTitle>
            <DialogDescription>
              Load "{pendingModel?.label}" into LM Studio? This may take a moment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setLoadConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmLoad}>Load Model</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
