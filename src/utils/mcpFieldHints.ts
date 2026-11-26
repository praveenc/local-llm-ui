/**
 * Hints for the MCP server form. The app starts a local server with no shell, so a quote that
 * the user types stays part of the value. Pure helper: no DOM and no Node imports.
 */

/** True when the trimmed text has two or more characters and starts and ends with the same quote. */
export function hasOuterQuotes(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return false;
  const first = text[0];
  return (first === '"' || first === "'") && text[text.length - 1] === first;
}
