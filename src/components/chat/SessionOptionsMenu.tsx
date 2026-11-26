/**
 * SessionOptionsMenu
 *
 * Button in the chat input with the other options of a harness session (K9), for example
 * Kiro's Autopilot. Each option is a labelled group with the harness's names, its values as
 * radio items, and the harness's descriptions as help text. A pick applies to the next message
 * of the chat. ChatContainer shows it only when the session lists such options.
 */
import { SlidersHorizontal } from 'lucide-react';

import { Fragment } from 'react';

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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { type SessionOption, currentValueName } from '../../utils/sessionOptions';
import { composerChip } from './composerStyles';

interface SessionOptionsMenuProps {
  /** The options with the values to show as current, in the harness's order */
  options: SessionOption[];
  onChange: (id: string, value: string) => void;
  disabled?: boolean;
}

/** "Autopilot: Supervised · Memory reflection: On": the current values in words */
function sessionOptionsSummary(options: SessionOption[]): string {
  return options.map((o) => `${o.name}: ${currentValueName(o)}`).join(' · ');
}

export function SessionOptionsMenu({ options, onChange, disabled }: SessionOptionsMenuProps) {
  const summary = sessionOptionsSummary(options);

  return (
    <DropdownMenu modal={false}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={composerChip}
                disabled={disabled}
                aria-label={`Session options: ${summary}`}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                {/* Icon only: with the agent name and the context ring, a word does not fit in one row */}
                <span className="sr-only">Options</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>{summary}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        side="top"
        align="end"
        className="z-[1100] max-h-[min(60vh,28rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        {options.map((option, index) => (
          <Fragment key={option.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{option.name}</span>
              {option.description && (
                <span className="text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label={option.name}
              value={option.currentValue}
              onValueChange={(value) => {
                if (value !== option.currentValue) onChange(option.id, value);
              }}
            >
              {option.values.map((v) => (
                <DropdownMenuRadioItem
                  key={v.value}
                  value={v.value}
                  className="min-h-11 items-start text-xs md:min-h-8"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline justify-between gap-2">
                      <span>{v.name}</span>
                      {/* State in words, not only the radio dot */}
                      {v.value === option.currentValue && (
                        <span className="shrink-0 text-muted-foreground">Current</span>
                      )}
                    </span>
                    {v.description && (
                      <span className="text-muted-foreground">{v.description}</span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
