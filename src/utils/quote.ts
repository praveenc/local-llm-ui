/**
 * Helpers for the Quote and Ask feature
 */

/**
 * Turn quoted text into a Markdown blockquote.
 * Each line gets a "> " prefix; blank lines become ">" so the quote stays one block.
 */
export function toBlockquote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimEnd();
      return trimmed ? `> ${trimmed}` : '>';
    })
    .join('\n');
}

/**
 * Build the message text sent for a quote and its response:
 *
 *   <quote>
 *   quoted text
 *   </quote>
 *
 *   response
 */
export function formatQuoteMessage(quote: string, response: string): string {
  const quoted = quote.replace(/\r\n/g, '\n').trim();
  const reply = response.trim();
  if (!quoted) return reply;
  const block = `<quote>\n${quoted}\n</quote>`;
  return reply ? `${block}\n\n${reply}` : block;
}

/**
 * For display only: turn <quote> blocks into Markdown blockquotes, so the
 * chat shows the quote as a quote instead of plain text.
 */
export function quoteTagsToMarkdown(text: string): string {
  return text.replace(/<quote>([\s\S]*?)<\/quote>/g, (_, inner: string) => toBlockquote(inner));
}
