/**
 * ThinkingEffortSelector
 *
 * Pill in the chat input that sets how much the model thinks before it answers.
 * ChatContainer shows it only for models that accept a thinking effort
 * (see utils/thinkingEffort).
 */
import { Brain, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  THINKING_EFFORT_OPTIONS,
  isThinkingEffort,
  thinkingEffortLabel,
} from '../../utils/thinkingEffort';
import type { ThinkingEffort } from '../../utils/thinkingEffort';

interface ThinkingEffortSelectorProps {
  value: ThinkingEffort;
  onChange: (value: ThinkingEffort) => void;
  disabled?: boolean;
}

export function ThinkingEffortSelector({ value, onChange, disabled }: ThinkingEffortSelectorProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3" disabled={disabled}>
          <Brain className="h-3 w-3" aria-hidden />
          <span className="text-xs">Thinking: {thinkingEffortLabel(value)}</span>
          <ChevronDown className="h-3 w-3 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="z-[1100] w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Thinking effort
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isThinkingEffort(next)) onChange(next);
          }}
        >
          {THINKING_EFFORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
