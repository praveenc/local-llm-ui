import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const [search, setSearch] = useState('');

  // Find current label
  const currentLabel = useMemo(() => {
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
  }, [value, models]);

  // Filter models based on search
  const filteredModels = useMemo(() => {
    if (!search) return models;
    const lowerSearch = search.toLowerCase();

    return models
      .map((item) => {
        if (isModelGroup(item)) {
          const filteredOptions = item.options.filter(
            (opt) =>
              opt.label.toLowerCase().includes(lowerSearch) ||
              opt.value.toLowerCase().includes(lowerSearch)
          );
          if (filteredOptions.length === 0) return null;
          return { ...item, options: filteredOptions };
        } else {
          if (
            item.label.toLowerCase().includes(lowerSearch) ||
            item.value.toLowerCase().includes(lowerSearch)
          ) {
            return item;
          }
          return null;
        }
      })
      .filter(Boolean) as (ModelOption | ModelGroup)[];
  }, [models, search]);

  const handleSelect = (modelValue: string, modelLabel: string) => {
    onValueChange(modelValue, modelLabel);
    setOpen(false);
    setSearch('');
  };

  if (error) {
    return (
      <Button variant="outline" className="w-full justify-start text-destructive text-xs" disabled>
        <span className="truncate">{error}</span>
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
        <div className="p-2 border-b">
          <Input
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <ScrollArea className="h-[300px]">
          {filteredModels.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No models found.</div>
          ) : (
            <div className="p-1">
              {filteredModels.map((item, idx) =>
                isModelGroup(item) ? (
                  <div key={item.label} className="mb-2">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {item.label}
                    </div>
                    {item.options.map((opt) => (
                      <button
                        key={opt.value}
                        className={cn(
                          'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                          value === opt.value && 'bg-accent'
                        )}
                        onClick={() => handleSelect(opt.value, opt.label)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            value === opt.value ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    key={item.value || idx}
                    className={cn(
                      'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                      value === item.value && 'bg-accent'
                    )}
                    onClick={() => handleSelect(item.value, item.label)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === item.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
