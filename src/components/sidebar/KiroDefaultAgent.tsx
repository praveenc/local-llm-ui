/**
 * The default agent of new Kiro chats (D9), in the Kiro row after sign-in.
 *
 * The list is Kiro's own agent list from the models response (the `mode` option of a new
 * session). "Kiro's default" is the first entry and means no preference. The choice is a browser
 * preference and not a security boundary: the server accepts only agents that Kiro lists (SEC-20).
 */
import { Bot, ChevronDown } from 'lucide-react';

import { useId, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { kiroService } from '../../services/kiro';
import { defaultModeValues } from '../../utils/sessionOptions';
import type { SessionOptionValue } from '../../utils/sessionOptions';
import { SessionAgentList } from '../chat/SessionAgentList';

/** The list entry for no preference. The agent list never has this id. */
const KIRO_DEFAULT = '__kiro-default__';
const KIRO_DEFAULT_NAME = "Kiro's default";

interface KiroDefaultAgentProps {
  /** The stored agent id; undefined means Kiro's default */
  value: string | undefined;
  onChange: (agentId: string | undefined) => void;
}

export function KiroDefaultAgent({ value, onChange }: KiroDefaultAgentProps) {
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const helpId = `${fieldId}-help`;
  const noteId = `${fieldId}-note`;
  const labelId = `${fieldId}-label`;
  const valueId = `${fieldId}-value`;
  const lists = useSyncExternalStore(kiroService.subscribeSessionOptions, () =>
    kiroService.getSessionOptions()
  );

  const { missing } = defaultModeValues(lists, value);
  const agents: SessionOptionValue[] = lists?.mode?.values ?? [];
  const listed = value ? agents.find((agent) => agent.value === value) : undefined;
  const values: SessionOptionValue[] = [
    {
      value: KIRO_DEFAULT,
      name: KIRO_DEFAULT_NAME,
      description: 'Use the agent that Kiro starts with.',
    },
    ...agents,
  ];
  // A stored agent that Kiro does not list has no effect, so the row shows Kiro's default.
  // Before Kiro's list has loaded, the stored id is the only name that the row has.
  const currentValue = listed ? listed.value : KIRO_DEFAULT;
  const label = listed
    ? listed.name
    : lists?.mode
      ? KIRO_DEFAULT_NAME
      : (value ?? KIRO_DEFAULT_NAME);

  return (
    <div className="space-y-2 border-t bg-muted/40 py-2 pl-10 pr-3">
      <Label id={labelId} htmlFor={fieldId} className="block text-xs font-normal">
        Default agent
      </Label>
      {/* Opening the list loads Kiro's agents again, throttled for the app (D26) */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void kiroService.refreshDefaultSessionOptions();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={fieldId}
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full max-w-72 justify-between gap-2 pointer-coarse:h-11"
            aria-labelledby={`${labelId} ${valueId}`}
            aria-describedby={missing ? `${helpId} ${noteId}` : helpId}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Bot className="size-3.5 shrink-0" aria-hidden />
              <span id={valueId} className="truncate">
                {label}
              </span>
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[1100] w-80 max-w-[calc(100vw-2rem)] p-0">
          <SessionAgentList
            values={values}
            currentValue={currentValue}
            onSelect={(picked) => {
              const next = picked === KIRO_DEFAULT ? undefined : picked;
              // A stored id that Kiro does not list counts as no preference here, so picking
              // Kiro's default clears it
              if (next !== value) onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <p id={helpId} className="text-xs text-muted-foreground">
        A new Kiro chat starts with this agent. An agent can have its own rules that run some tools
        without a question. When you pick an agent, you accept its rules.
      </p>
      {missing && (
        <p id={noteId} role="status" className="text-xs text-muted-foreground">
          This agent is no longer in Kiro&apos;s list.
        </p>
      )}
    </div>
  );
}
