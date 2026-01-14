/**
 * InferenceSettings Component
 *
 * Popover with inference config controls (temperature, top_p, max_tokens)
 * for the PromptInput footer.
 */
import { Settings2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';

type SamplingParameter = 'temperature' | 'topP';

interface InferenceSettingsProps {
  temperature: number;
  setTemperature: (value: number) => void;
  topP: number;
  setTopP: (value: number) => void;
  maxTokens: number;
  setMaxTokens: (value: number) => void;
  samplingParameter: SamplingParameter;
  setSamplingParameter: (value: SamplingParameter) => void;
  disabled?: boolean;
}

export function InferenceSettings({
  temperature,
  setTemperature,
  topP,
  setTopP,
  maxTokens,
  setMaxTokens,
  samplingParameter,
  setSamplingParameter,
  disabled,
}: InferenceSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          disabled={disabled}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-4 z-[1100]">
        <div className="space-y-4">
          <div className="text-sm font-medium">Inference Settings</div>

          {/* Sampling Parameter Toggle */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sampling Parameter</Label>
            <div className="flex gap-1">
              <Button
                variant={samplingParameter === 'temperature' ? 'secondary' : 'ghost'}
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => setSamplingParameter('temperature')}
              >
                Temperature
              </Button>
              <Button
                variant={samplingParameter === 'topP' ? 'secondary' : 'ghost'}
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => setSamplingParameter('topP')}
              >
                Top P
              </Button>
            </div>
          </div>

          {/* Temperature Slider */}
          {samplingParameter === 'temperature' && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Temperature</Label>
                <span className="text-xs text-muted-foreground">{temperature.toFixed(2)}</span>
              </div>
              <Slider
                value={[temperature]}
                onValueChange={([value]) => setTemperature(value)}
                min={0}
                max={1}
                step={0.01}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>
          )}

          {/* Top P Slider */}
          {samplingParameter === 'topP' && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Top P</Label>
                <span className="text-xs text-muted-foreground">{topP.toFixed(2)}</span>
              </div>
              <Slider
                value={[topP]}
                onValueChange={([value]) => setTopP(value)}
                min={0}
                max={1}
                step={0.01}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Focused</span>
                <span>Diverse</span>
              </div>
            </div>
          )}

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
        </div>
      </PopoverContent>
    </Popover>
  );
}
