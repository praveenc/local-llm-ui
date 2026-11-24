/**
 * One rule for a chat title typed by the user, shared by the sidebar and the header.
 * Trims the text and turns every run of white space (also line breaks) into one space.
 * Returns null when nothing is left, so the caller keeps the old title.
 */
export function normalizeTitle(input: string): string | null {
  const title = input.replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}
