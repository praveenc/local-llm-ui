/**
 * InferenceSettings Component
 *
 * Popover with inference config controls (max tokens, max tool steps) for the
 * PromptInput footer. The app does not send temperature or top_p: models use their own
 * sampling settings.
 */
import { Settings2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';

import { MAX_TOOL_STEPS, MIN_TOOL_STEPS } from '../../utils/toolSteps';
import { composerIconButton } from './composerStyles';

interface InferenceSettingsProps {
  maxTokens: number;
  setMaxTokens: (value: number) => void;
  /** Most model calls in one reply when web search or MCP tools are on */
  maxToolSteps: number;
  setMaxToolSteps: (value: number) => void;
  disabled?: boolean;
}

export function InferenceSettings({
  maxTokens,
  setMaxTokens,
  maxToolSteps,
  setMaxToolSteps,
  disabled,
}: InferenceSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={composerIconButton}
          disabled={disabled}
          aria-label="Inference settings"
          title="Inference settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-4 z-[1100]">
        <div className="space-y-4">
          <div className="text-sm font-medium">Inference Settings</div>

          {/* Max Tokens Slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <span className="text-xs text-muted-foreground">{maxTokens.toLocaleString()}</span>
            </div>
            <Slider
              value={[maxTokens]}
              onValueChange={([value]) => setMaxTokens(value)}
              min={256}
              max={16384}
              step={256}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>256</span>
              <span>16K</span>
            </div>
          </div>

          {/* Max Tool Steps Slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label id="max-tool-steps-label" className="text-xs text-muted-foreground">
                Max Tool Steps
              </Label>
              <span className="text-xs text-muted-foreground" data-testid="max-tool-steps-value">
                {maxToolSteps}
              </span>
            </div>
            <Slider
              aria-labelledby="max-tool-steps-label"
              value={[maxToolSteps]}
              onValueChange={([value]) => setMaxToolSteps(value)}
              min={MIN_TOOL_STEPS}
              max={MAX_TOOL_STEPS}
              step={1}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground">
              Model calls in one reply when web search or MCP tools are on. The last call writes the
              answer.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
