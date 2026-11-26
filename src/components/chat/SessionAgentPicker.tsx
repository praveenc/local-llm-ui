/**
 * SessionAgentPicker
 *
 * Pill in the chat input that picks the agent of a harness session (the option of ACP category
 * `mode`, K9; Kiro calls it Mode). It shows the harness's own names and descriptions. A pick applies to the next
 * message of the chat. ChatContainer shows it only when the session lists the option.
 */
import { Bot, Check, ChevronDown } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { type SessionOption, currentValueName } from '../../utils/sessionOptions';
import { composerChip } from './composerStyles';

interface SessionAgentPickerProps {
  /** The `mode` option with the value to show as current */
  option: SessionOption;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SessionAgentPicker({ option, onChange, disabled }: SessionAgentPickerProps) {
  const [open, setOpen] = useState(false);
  const current = currentValueName(option);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={composerChip}
                disabled={disabled}
                aria-label={`Agent: ${current}`}
              >
                <Bot className="size-3.5" aria-hidden />
                {/* The word goes when the chat input is narrow, so the toolbar keeps one row */}
                <span className="hidden sm:inline @max-3xl:hidden">Agent</span>
                <span className="max-w-24 truncate font-medium text-foreground">{current}</span>
                <ChevronDown className="size-3 opacity-60" aria-hidden />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{`Agent: ${current}`}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="end" className="z-[1100] w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Search agents" aria-label="Search agents" />
          <CommandList className="max-h-[min(50vh,20rem)]">
            <CommandEmpty>No match</CommandEmpty>
            {option.values.map((v) => {
              const isCurrent = v.value === option.currentValue;
              return (
                <CommandItem
                  key={v.value}
                  value={v.value}
                  keywords={[v.name, ...(v.description ? [v.description] : [])]}
                  onSelect={() => {
                    if (!isCurrent) onChange(v.value);
                    setOpen(false);
                  }}
                  aria-current={isCurrent || undefined}
                  className="min-h-11 items-start md:min-h-9"
                >
                  <Check
                    className={isCurrent ? 'mt-0.5 size-4' : 'mt-0.5 size-4 invisible'}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{v.name}</span>
                      {isCurrent && (
                        <span className="shrink-0 text-xs text-muted-foreground">Current</span>
                      )}
                    </span>
                    {v.description && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {v.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
