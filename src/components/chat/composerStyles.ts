/**
 * Shared classes for the controls in the chat input toolbar, so that every
 * button has the same height, shape, and states in every color theme.
 * Below `md` the hit areas grow to 44 px for touch; the icons keep their size.
 */

/**
 * The bordered card around the textarea and toolbar: a border and no shadow. Its fill is
 * halfway between the card and the page (--composer), so it does not glow on a light page.
 */
export const composerCard = [
  'rounded-2xl border-border bg-composer shadow-none dark:bg-composer',
  'has-[[data-slot=input-group-control]:focus-visible]:border-primary/50',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-4',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-primary/10',
].join(' ');

/**
 * The message box. Padding is 16 px at the sides and top and 8 px below; the footer adds 4 px, so
 * there are 12 px between the text and the toolbar. It grows to 40% of the window, at most
 * 320 px, and then scrolls inside. Compact density takes 4 px off the top.
 */
export const composerTextarea = [
  'px-4 pt-4 pb-2 compact:pt-3',
  'max-h-[min(40vh,20rem)]',
  'text-base leading-relaxed md:text-[15px] placeholder:text-muted-foreground',
].join(' ');

/**
 * The minimum height is a whole number of text lines. `lh` is the line height of the textarea
 * itself, so it is right at 16 px (mobile) and 15 px (md and up). The rem part is the padding.
 * An empty chat shows three lines; once the chat has messages, the input at the bottom shows two.
 */
export const composerTextareaEmpty = 'min-h-[calc(3lh+1.5rem)] compact:min-h-[calc(3lh+1.25rem)]';
export const composerTextareaBottom = 'min-h-[calc(2lh+1.5rem)] compact:min-h-[calc(2lh+1.25rem)]';

/** Round icon-only button */
export const composerIconButton =
  'size-11 md:size-8 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-accent hover:text-foreground has-[>svg]:p-0 dark:hover:bg-accent';

/** Pill with an icon and a text label, for example the model and thinking pickers */
export const composerChip =
  'h-11 md:h-8 gap-1.5 rounded-full px-3 text-[13px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground has-[>svg]:px-3 dark:hover:bg-accent';

/** State of a toggle that is on, for example web search */
export const composerActive =
  'bg-primary/12 text-primary hover:bg-primary/18 hover:text-primary dark:hover:bg-primary/18';

/** Tooltip of the web search and MCP buttons when the selected model cannot use tools */
export const TOOLS_UNSUPPORTED_TEXT = 'This model cannot use tools';
