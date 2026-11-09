/**
 * ColorThemePicker
 *
 * Radio cards for the color theme in Preferences > Display. Each card shows the
 * palette in the current visual mode, so the user sees what they will get.
 */
import { Check } from 'lucide-react';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

import { cn } from '@/lib/utils';

import { COLOR_THEMES, isColorTheme } from '../../utils/colorThemes';
import type { ColorTheme } from '../../utils/colorThemes';
import type { VisualMode } from '../../utils/preferences';

interface ColorThemePickerProps {
  value: ColorTheme;
  visualMode: VisualMode;
  onChange: (value: ColorTheme) => void;
}

export function ColorThemePicker({ value, visualMode, onChange }: ColorThemePickerProps) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => {
        if (isColorTheme(next)) onChange(next);
      }}
      aria-label="Color theme"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {COLOR_THEMES.map((theme) => {
        const swatch = theme[visualMode];
        const selected = theme.value === value;
        return (
          <RadioGroupPrimitive.Item
            key={theme.value}
            value={theme.value}
            aria-label={theme.label}
            className={cn(
              'group overflow-hidden rounded-xl border bg-card text-left transition-all outline-none',
              'hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              selected ? 'border-primary ring-1 ring-primary' : 'border-border'
            )}
          >
            {/* Small composer-shaped preview drawn in the theme colors */}
            <div
              aria-hidden
              className="flex h-20 flex-col justify-between p-3"
              style={{ background: swatch.background }}
            >
              <div className="space-y-1.5">
                <div
                  className="h-1.5 w-3/4 rounded-full opacity-80"
                  style={{ background: swatch.foreground }}
                />
                <div
                  className="h-1.5 w-1/2 rounded-full opacity-40"
                  style={{ background: swatch.foreground }}
                />
              </div>
              <div className="flex items-center gap-1.5">
                {swatch.accents.map((color) => (
                  <span
                    key={color}
                    className="size-2.5 rounded-full"
                    style={{ background: color }}
                  />
                ))}
                <span
                  className="ml-auto size-4 rounded-full"
                  style={{ background: swatch.primary }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{theme.label}</div>
                <div className="truncate text-xs text-muted-foreground">{swatch.name}</div>
              </div>
              <RadioGroupPrimitive.Indicator className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" strokeWidth={3} />
              </RadioGroupPrimitive.Indicator>
            </div>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
