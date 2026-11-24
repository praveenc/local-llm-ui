/**
 * What the work row says: the step that runs now, or a summary when the reply is done.
 *
 * Keep this file free of DOM and Node imports.
 */
import type { ToolCallPart } from '../types/ai-messages';
import { argsSummary } from './toolCallSummary';
import {
  isToolCallFailed,
  isWebSearchTool,
  parseSearchResults,
  shortToolName,
} from './toolResults';

export interface WorkSummary {
  /** Parts of the summary line, for example ["Thought 4 s", "3 searches", "18 sources"] */
  parts: string[];
  /** Tool calls that failed; shown as "1 failed" */
  failed: number;
}

/** The most distinct tool names listed one by one; more are counted as "N tool calls" */
const MAX_NAMED_TOOLS = 2;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Thought 4 s", "Thought 1 min 5 s", or "Thought" when the time is not known */
export function thoughtLabel(reasoningMs?: number): string {
  if (!reasoningMs || reasoningMs < 1000) return 'Thought';
  const seconds = Math.round(reasoningMs / 1000);
  if (seconds < 60) return `Thought ${seconds} s`;
  return `Thought ${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function summarizeWork({
  hasReasoning,
  reasoningMs,
  toolCalls,
}: {
  hasReasoning: boolean;
  reasoningMs?: number;
  toolCalls: ToolCallPart[];
}): WorkSummary {
  const parts: string[] = [];
  if (hasReasoning) parts.push(thoughtLabel(reasoningMs));

  const searches = toolCalls.filter((t) => isWebSearchTool(t.toolName));
  if (searches.length) {
    parts.push(plural(searches.length, 'search', 'searches'));
    const urls = new Set(
      searches.flatMap((s) => (parseSearchResults(s.result) ?? []).map((r) => r.url))
    );
    if (urls.size) parts.push(plural(urls.size, 'source'));
  }

  const others = toolCalls.filter((t) => !isWebSearchTool(t.toolName));
  const byName = new Map<string, number>();
  for (const t of others) {
    const name = shortToolName(t.toolName);
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  if (byName.size > MAX_NAMED_TOOLS) {
    parts.push(plural(others.length, 'tool call'));
  } else {
    for (const [name, count] of byName) parts.push(`${plural(count, `${name} call`)}`);
  }

  return { parts, failed: toolCalls.filter(isToolCallFailed).length };
}

const shorten = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The step that runs now, while the reply streams: the tool that waits for its result, else
 * "Thinking…" before any answer text. Undefined once the answer text streams.
 */
export function currentStep({
  hasReasoning,
  hasText,
  toolCalls,
}: {
  hasReasoning: boolean;
  hasText: boolean;
  toolCalls: ToolCallPart[];
}): string | undefined {
  const pending = [...toolCalls].reverse().find((t) => t.status === 'pending');
  if (pending) {
    const target = argsSummary(pending.args);
    if (isWebSearchTool(pending.toolName)) {
      return target ? `Searching “${shorten(target)}”` : 'Searching';
    }
    const name = shortToolName(pending.toolName);
    return target ? `Running ${name} · ${shorten(target)}` : `Running ${name}`;
  }
  if (hasText) return undefined;
  return hasReasoning && toolCalls.length === 0 ? 'Thinking…' : 'Working…';
}
