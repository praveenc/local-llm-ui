/**
 * Shared classes for the controls in the chat input toolbar, so that every
 * button has the same height, shape, and states in every color theme.
 */

/** The bordered card around the textarea and toolbar */
export const composerCard = [
  'rounded-2xl border-border bg-card shadow-lg dark:bg-card',
  'has-[[data-slot=input-group-control]:focus-visible]:border-primary/50',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-4',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-primary/10',
].join(' ');

/** Round icon-only button */
export const composerIconButton =
  'size-8 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-accent hover:text-foreground has-[>svg]:p-0 dark:hover:bg-accent';

/** Pill with an icon and a text label, for example the model and thinking pickers */
export const composerChip =
  'h-8 gap-1.5 rounded-full px-3 text-[13px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground has-[>svg]:px-3 dark:hover:bg-accent';

/** State of a toggle that is on, for example web search */
export const composerActive =
  'bg-primary/12 text-primary hover:bg-primary/18 hover:text-primary dark:hover:bg-primary/18';
