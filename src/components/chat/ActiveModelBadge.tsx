/**
 * ActiveModelBadge
 *
 * A lightweight sticky badge that shows the currently active model name
 * and provider at the top of the conversation area. Ensures the user
 * always knows which model (and inference profile) they are chatting with.
 */
import type { UnifiedModel } from '../../hooks/useAllModels';
import { ModelSelectorLogo } from '../ai-elements/model-selector';
import { PROVIDER_LOGO_MAP } from './provider-logos';

interface ActiveModelBadgeProps {
  model: UnifiedModel;
}

export const ActiveModelBadge = ({ model }: ActiveModelBadgeProps) => (
  <div className="sticky top-0 z-10 flex justify-center py-2">
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/60 backdrop-blur-sm border border-border/50 text-xs text-muted-foreground shadow-sm"
      aria-label={`Active model: ${model.name} via ${model.providerName}`}
    >
      <ModelSelectorLogo
        provider={PROVIDER_LOGO_MAP[model.provider] || model.provider}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="font-medium text-foreground/80">{model.name}</span>
      <span className="text-border">·</span>
      <span className="text-muted-foreground/70">{model.providerName}</span>
    </div>
  </div>
);

export default ActiveModelBadge;
