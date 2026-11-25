/**
 * ModelSelectorButton
 *
 * A button that opens the AI Elements ModelSelector dialog.
 * Displays the currently selected model and allows switching between all available models.
 */
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCreditRate } from '@/utils/kiroModels';
import { modelLabel } from '@/utils/modelLabel';
import { isModelPickerShortcut, modelPickerShortcutLabel } from '@/utils/shortcuts';

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
import { ProviderActionButton } from './ProviderActionButton';
import { composerChip } from './composerStyles';
import { PROVIDER_LOGO_MAP } from './provider-logos';
import { getProviderHelp } from './providerHelp';

interface ModelSelectorButtonProps {
  providers: ProviderModels[];
  selectedModel: UnifiedModel | null;
  onSelectModel: (model: UnifiedModel) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  onOpenPreferences?: () => void;
  /** Optional control, so the chat can open the picker (for example from an error) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ModelSelectorButton({
  providers,
  selectedModel,
  onSelectModel,
  isLoading,
  disabled,
  className,
  onOpenPreferences,
  open: openProp,
  onOpenChange,
}: ModelSelectorButtonProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  // The picker opens while providers are still probed; those show as "Checking..."
  const blocked = disabled;

  // Cmd/Ctrl+K opens the picker from anywhere, the message box included
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isModelPickerShortcut(e)) return;
      e.preventDefault();
      if (!blocked) {
        setOpenState(true);
        onOpenChange?.(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blocked, onOpenChange]);

  const handleSelect = (model: UnifiedModel) => {
    onSelectModel(model);
    setOpen(false);
  };

  const activeProviders = providers.filter((provider) => provider.models.length > 0);
  const selectedLabel = selectedModel ? modelLabel(selectedModel).label : undefined;
  const unavailableProviders = providers.filter((provider) => provider.status === 'error');
  const checkingProviders = providers.filter((provider) => provider.status === 'loading');

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked}
          className={cn(composerChip, 'min-w-0 text-foreground', className)}
          title={
            selectedModel
              ? `${selectedModel.name} · ${selectedModel.providerName} (${modelPickerShortcutLabel()} to change)`
              : `Select model (${modelPickerShortcutLabel()})`
          }
          aria-keyshortcuts="Meta+K Control+K"
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
              <span className="truncate max-w-[160px] sm:max-w-[260px] font-medium">
                {selectedLabel}
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
          <ModelSelectorEmpty>
            {checkingProviders.length > 0 ? 'Still checking providers…' : 'No models found.'}
          </ModelSelectorEmpty>
          {activeProviders.map((provider) => (
            <ModelSelectorGroup key={provider.provider} heading={groupHeading(provider)}>
              {provider.models.map((model) => {
                const detail = modelDetail(model);
                return (
                  <ModelSelectorItem
                    key={`${model.provider}-${model.id}`}
                    value={`${model.provider}:${model.id}`}
                    // The value is the ID; the name ("Claude Haiku 5.5", with its dot) is a keyword
                    keywords={[
                      model.name,
                      modelLabel(model).label,
                      model.providerName,
                      model.family ?? '',
                    ]}
                    onSelect={() => handleSelect(model)}
                    className="cursor-pointer items-start"
                  >
                    <ModelSelectorLogo
                      provider={PROVIDER_LOGO_MAP[model.provider] || model.provider}
                      className="mt-0.5 h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <ModelSelectorName title={model.name}>
                        {modelLabel(model).label}
                      </ModelSelectorName>
                      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                    </div>
                    {selectedModel?.id === model.id &&
                      selectedModel?.provider === model.provider && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}

          {checkingProviders.map((provider) => (
            <ModelSelectorGroup
              key={`checking-${provider.provider}`}
              heading={`${provider.providerName} · Checking…`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Looking for models
              </div>
            </ModelSelectorGroup>
          ))}

          {activeProviders.length + checkingProviders.length > 0 &&
            unavailableProviders.length > 0 && <ModelSelectorSeparator />}

          {unavailableProviders.map((provider) => {
            const help = getProviderHelp(provider);
            return (
              <ModelSelectorGroup
                key={`unavailable-${provider.provider}`}
                heading={`${provider.providerName} · ${help.status}`}
              >
                {/* A plain row, not a command item, so its action button can be clicked */}
                <div className="flex items-start gap-2 rounded-sm px-2 py-1.5">
                  <ModelSelectorLogo
                    provider={PROVIDER_LOGO_MAP[provider.provider] || provider.provider}
                    className="mt-0.5 h-4 w-4 opacity-60"
                  />
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">{help.hint}</p>
                  <ProviderActionButton
                    action={help.action}
                    onOpenPreferences={() => {
                      setOpen(false);
                      onOpenPreferences?.();
                    }}
                  />
                </div>
              </ModelSelectorGroup>
            );
          })}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

/** "Ollama · 3 models" */
const groupHeading = (provider: ProviderModels): string =>
  `${provider.providerName} · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`;

/**
 * Grey subline from what the provider reports about the model: its family and whether it can
 * think. shortcut: no context window or tool support here, because the model objects do not
 * carry them; add them when the services return them.
 */
const modelDetail = (model: UnifiedModel): string => {
  // Kiro: its description and the credit rate, for example
  // "Claude Opus 5.5 model with 1M context window · 2× credits"
  if (model.provider === 'kiro') {
    const rate = model.kiro?.rateMultiplier;
    return [model.kiro?.description, rate !== undefined ? formatCreditRate(rate) : undefined]
      .filter(Boolean)
      .join(' · ');
  }
  return [model.family, model.supportsThinking ? 'Thinking' : undefined]
    .filter(Boolean)
    .join(' · ');
};

export default ModelSelectorButton;
