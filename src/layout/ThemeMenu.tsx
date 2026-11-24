/**
 * ThemeMenu
 *
 * Header menu for the color theme and the visual mode (system, light, or dark). It saves the same
 * preferences as Preferences > Display.
 */
import { Monitor, Moon, Palette, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { COLOR_THEMES, isColorTheme } from '@/utils/colorThemes';
import type { ColorTheme, ResolvedVisualMode } from '@/utils/colorThemes';
import type { VisualMode } from '@/utils/preferences';

interface ThemeMenuProps {
  colorTheme: ColorTheme;
  visualMode: VisualMode;
  /** Scheme drawn now, so the swatches show the variant the user sees */
  resolvedVisualMode: ResolvedVisualMode;
  onColorThemeChange: (value: ColorTheme) => void;
  onVisualModeChange: (value: VisualMode) => void;
}

const isVisualMode = (value: string): value is VisualMode =>
  value === 'system' || value === 'light' || value === 'dark';

export function ThemeMenu({
  colorTheme,
  visualMode,
  resolvedVisualMode,
  onColorThemeChange,
  onVisualModeChange,
}: ThemeMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-9"
          aria-label="Theme"
          title="Theme"
        >
          <Palette className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Color theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={colorTheme}
          onValueChange={(next) => {
            if (isColorTheme(next)) onColorThemeChange(next);
          }}
        >
          {COLOR_THEMES.map((theme) => {
            const swatch = theme[resolvedVisualMode];
            return (
              <DropdownMenuRadioItem key={theme.value} value={theme.value}>
                <span className="flex-1">{theme.label}</span>
                {/* Background, primary, and the accents of the current variant */}
                <span aria-hidden className="flex items-center gap-0.5">
                  {[swatch.background, swatch.primary, ...swatch.accents].map((color, index) => (
                    <span
                      key={`${color}-${index}`}
                      // The swatch is the information: keep its colour in forced-colors mode
                      className="size-3 rounded-full ring-1 ring-border forced-color-adjust-none"
                      style={{ background: color }}
                    />
                  ))}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={visualMode}
          onValueChange={(next) => {
            if (isVisualMode(next)) onVisualModeChange(next);
          }}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" aria-hidden />
            System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" aria-hidden />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" aria-hidden />
            Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
