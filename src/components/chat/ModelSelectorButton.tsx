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
  ModelSelectorSeparator,
  ModelSelectorTrigger,
} from '../ai-elements/model-selector';
import { composerChip } from './composerStyles';
import { PROVIDER_LOGO_MAP } from './provider-logos';

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

  const activeProviders = providers.filter((provider) => provider.models.length > 0);
  const unavailableProviders = providers.filter((provider) => provider.status === 'error');

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || isLoading}
          className={cn(composerChip, 'min-w-0 text-foreground', className)}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-muted-foreground">Loading models...</span>
            </>
          ) : selectedModel ? (
            <>
              <ModelSelectorLogo
                provider={PROVIDER_LOGO_MAP[selectedModel.provider] || selectedModel.provider}
                className="size-3.5"
              />
              <span
                className="truncate max-w-[160px] sm:max-w-[260px] font-medium"
                title={selectedModel.name}
              >
                {selectedModel.name}
              </span>
              <ChevronDown className="size-3 opacity-60" />
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Select model</span>
              <ChevronDown className="size-3 opacity-60" />
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

          {activeProviders.length > 0 && unavailableProviders.length > 0 && (
            <ModelSelectorSeparator />
          )}

          {unavailableProviders.length > 0 && (
            <ModelSelectorGroup heading="Unavailable providers">
              {unavailableProviders.map((provider) => (
                <ModelSelectorItem
                  key={`unavailable-${provider.provider}`}
                  value={`unavailable:${provider.provider}`}
                  disabled
                  className="cursor-default opacity-100"
                >
                  <ModelSelectorLogo
                    provider={PROVIDER_LOGO_MAP[provider.provider] || provider.provider}
                    className="h-4 w-4 opacity-60"
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm text-foreground/80">
                      {provider.providerName}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {provider.error || 'Currently unavailable'}
                    </p>
                  </div>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          )}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export default ModelSelectorButton;
