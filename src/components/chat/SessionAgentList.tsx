/**
 * SessionAgentList
 *
 * The searchable list of a harness's agents: name, description, and a mark on the current one.
 * Shared by the Agent picker in the chat input (K9) and the Default agent row in Preferences (D9).
 * The caller puts it in a popover and closes the popover in `onSelect`.
 */
import { Check } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

import type { SessionOptionValue } from '../../utils/sessionOptions';

interface SessionAgentListProps {
  values: SessionOptionValue[];
  /** The value that gets the Current mark */
  currentValue: string;
  /** Called for every pick, also for the current value */
  onSelect: (value: string) => void;
}

export function SessionAgentList({ values, currentValue, onSelect }: SessionAgentListProps) {
  return (
    <Command>
      <CommandInput placeholder="Search agents" aria-label="Search agents" />
      <CommandList className="max-h-[min(50vh,20rem)]">
        <CommandEmpty>No match</CommandEmpty>
        {values.map((v) => {
          const isCurrent = v.value === currentValue;
          return (
            <CommandItem
              key={v.value}
              value={v.value}
              keywords={[v.name, ...(v.description ? [v.description] : [])]}
              onSelect={() => onSelect(v.value)}
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
  );
}
