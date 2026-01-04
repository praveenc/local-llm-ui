import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { ModelGroup, ModelOption } from '../../hooks/useProviderModels';

interface ModelSelectProps {
  models: (ModelOption | ModelGroup)[];
  value: string | null;
  onValueChange: (value: string, label: string) => void;
  isLoading?: boolean;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
}

function isModelGroup(item: ModelOption | ModelGroup): item is ModelGroup {
  return 'options' in item;
}

export function ModelSelect({
  models,
  value,
  onValueChange,
  isLoading,
  error,
  disabled,
  placeholder = 'Select model...',
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);

  // Find current label
  const findLabel = (): string => {
    if (!value) return '';
    for (const item of models) {
      if (isModelGroup(item)) {
        const found = item.options.find((opt) => opt.value === value);
        if (found) return found.label;
      } else if (item.value === value) {
        return item.label;
      }
    }
    return '';
  };

  const currentLabel = findLabel();

  if (error) {
    return (
      <Button variant="outline" className="w-full justify-start text-destructive" disabled>
        <span className="truncate text-sm">{error}</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 text-sm"
          disabled={disabled || isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </span>
          ) : currentLabel ? (
            <span className="truncate">{currentLabel}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {models.map((item, idx) =>
              isModelGroup(item) ? (
                <CommandGroup key={item.label} heading={item.label}>
                  {item.options.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => {
                        onValueChange(opt.value, opt.label);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === opt.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandItem
                  key={item.value || idx}
                  value={item.value}
                  onSelect={() => {
                    onValueChange(item.value, item.label);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === item.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </CommandItem>
              )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
