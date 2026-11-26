/**
 * Parts that the Conversations list and the Kiro sessions list share: the Search chats field
 * (one field filters both) and the header of a date group.
 */
import { ChevronRight, Search } from 'lucide-react';

import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

/** "Search chats": Esc clears it */
export function ChatSearchInput({ value, onChange }: ChatSearchInputProps) {
  return (
    <div className="relative px-2 pb-1">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-[calc(50%+2px)] text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder="Search chats"
        aria-label="Search chats"
        className="h-8 pl-7 text-sm"
      />
    </div>
  );
}

interface GroupHeaderProps {
  label: string;
  count: number;
  open: boolean;
  /** What the group holds, for the count of a closed group: "8 chats" */
  noun: { one: string; other: string };
}

/** The header of a date group. It stays at the top of the list while its rows scroll by. */
export function GroupHeader({ label, count, open, noun }: GroupHeaderProps) {
  return (
    <h3 className="sticky top-0 z-10 bg-sidebar px-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          // A closed group says how many items it hides: "Previous 30 days, 8 chats"
          aria-label={
            open ? undefined : `${label}, ${count} ${count === 1 ? noun.one : noun.other}`
          }
          className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 shrink-0 transition-transform motion-reduce:transition-none',
              open && 'rotate-90'
            )}
          />
          <span className="truncate">{label}</span>
          {!open && (
            <span aria-hidden className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
    </h3>
  );
}
