/**
 * ModelSelectorButton
 *
 * A button that opens the AI Elements ModelSelector dialog.
 * Displays the currently selected model and allows switching between all available models.
 */
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '../ai-elements/model-selector';

// Map provider to ModelSelectorLogo provider name
const PROVIDER_LOGO_MAP: Record<string, string> = {
  bedrock: 'amazon-bedrock',
  'bedrock-mantle': 'amazon-bedrock',
  groq: 'groq',
  cerebras: 'cerebras',
  lmstudio: 'lmstudio',
  ollama: 'llama',
};

interface ModelSelectorButtonProps {
  providers: ProviderModels[];
  selectedModel: UnifiedModel | null;
  onSelectModel: (model: UnifiedModel) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ModelSelectorButton({
  providers,
  selectedModel,
  onSelectModel,
  isLoading,
  disabled,
  className,
}: ModelSelectorButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (model: UnifiedModel) => {
    onSelectModel(model);
    setOpen(false);
  };

  // Filter providers that have models
  const activeProviders = providers.filter((p) => p.models.length > 0);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isLoading}
          className={cn('gap-2 h-8 px-3', className)}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">Loading models...</span>
            </>
          ) : selectedModel ? (
            <>
              <ModelSelectorLogo
                provider={PROVIDER_LOGO_MAP[selectedModel.provider] || selectedModel.provider}
                className="h-3 w-3"
              />
              <span className="text-xs truncate max-w-[120px]">{selectedModel.name}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">Select model</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </>
          )}
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent className="w-[400px]" showCloseButton>
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList className="max-h-[400px]">
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {activeProviders.map((provider) => (
            <ModelSelectorGroup key={provider.provider} heading={provider.providerName}>
              {provider.models.map((model) => (
                <ModelSelectorItem
                  key={`${model.provider}-${model.id}`}
                  value={`${model.provider}:${model.id}`}
                  onSelect={() => handleSelect(model)}
                  className="cursor-pointer"
                >
                  <ModelSelectorLogo
                    provider={PROVIDER_LOGO_MAP[model.provider] || model.provider}
                    className="h-4 w-4"
                  />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                  {selectedModel?.id === model.id && selectedModel?.provider === model.provider && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export default ModelSelectorButton;
