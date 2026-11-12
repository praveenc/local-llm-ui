/**
 * One line that says what a tool call did, for the header. Web search shows its query; other
 * tools show the first string argument that looks like a target (url, path, query, name), else
 * the first string argument.
 */
export function argsSummary(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const preferred = ['query', 'url', 'path', 'file_path', 'name', 'command', 'prompt'];
  for (const key of preferred) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key].trim();
  }
  const first = Object.values(args).find((v) => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? first.trim() : undefined;
}
