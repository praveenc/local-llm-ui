/**
 * Maps the session/update notifications of one reply to the app's SSE events: text, reasoning,
 * tool calls, and tool results. Every other kind goes to `onOther` (the harness reads its own
 * `_meta` fields there).
 */
import type { SessionUpdate, ToolCallUpdate } from './types.ts';

export const MAX_TOOL_OUTPUT = 20_000;

/** The SSE events that the mapper sends */
export type AcpStreamEvent =
  | { content: string }
  | { reasoning: string }
  | { toolCall: { id: string; name: string; args: Record<string, unknown> } }
  | { toolResult: { id: string; name: string; result?: string; error?: string } };

export interface UpdateMapperOptions {
  send(event: AcpStreamEvent): void;
  /** The name that the work row shows for a tool call */
  toolName(update: Pick<ToolCallUpdate, 'toolCallId' | 'title' | 'kind'>): string;
  /** The error text of a tool call that the app denied */
  deniedText: string;
  /** Every update that is not a chunk or a tool call */
  onOther?(update: SessionUpdate): void;
}

export interface UpdateMapper {
  onUpdate(update: SessionUpdate): void;
  /** The app denied this tool call: its failed result says deniedText */
  markDenied(toolCallId: string): void;
  /** True once the reply sent text that is not empty */
  readonly hasText: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The text of a tool's output: the text items of `content`, else rawOutput */
export function toolOutputText(update: Pick<ToolCallUpdate, 'content' | 'rawOutput'>): string {
  const texts: string[] = [];
  for (const item of Array.isArray(update.content) ? update.content : []) {
    const inner = asRecord(asRecord(item)?.content);
    if (asRecord(item)?.type === 'content' && inner?.type === 'text') {
      if (typeof inner.text === 'string') texts.push(inner.text);
    }
  }
  let text: string;
  if (texts.length > 0) text = texts.join('\n\n');
  else if (typeof update.rawOutput === 'string') text = update.rawOutput;
  else if (update.rawOutput === undefined) text = '';
  else text = JSON.stringify(update.rawOutput) ?? '';
  return text.slice(0, MAX_TOOL_OUTPUT);
}

export function createUpdateMapper(options: UpdateMapperOptions): UpdateMapper {
  const { send } = options;
  // The reply's tool calls, by id, and the ones that the app denied
  const tools = new Map<string, { name: string; done: boolean }>();
  const denied = new Set<string>();
  let hasText = false;

  const announce = (update: ToolCallUpdate) => {
    let tool = tools.get(update.toolCallId);
    if (!tool) {
      tool = { name: options.toolName(update), done: false };
      tools.set(update.toolCallId, tool);
      const args = asRecord(update.rawInput) ?? {};
      send({ toolCall: { id: update.toolCallId, name: tool.name, args } });
    }
    return tool;
  };

  const onUpdate = (update: SessionUpdate) => {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const content = asRecord(update.content);
        if (content?.type !== 'text' || typeof content.text !== 'string') return;
        if (update.sessionUpdate === 'agent_message_chunk') {
          if (content.text) hasText = true;
          send({ content: content.text });
        } else send({ reasoning: content.text });
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const tool = update as ToolCallUpdate;
        if (typeof tool.toolCallId !== 'string' || !tool.toolCallId) return;
        const known = tools.get(tool.toolCallId);
        if (update.sessionUpdate === 'tool_call') {
          announce(tool);
          if (tool.status !== 'completed' && tool.status !== 'failed') return;
        } else if (tool.status !== 'completed' && tool.status !== 'failed') {
          return;
        }
        const entry = known ?? announce(tool);
        if (entry.done) return;
        entry.done = true;
        if (tool.status === 'completed') {
          send({
            toolResult: { id: tool.toolCallId, name: entry.name, result: toolOutputText(tool) },
          });
        } else {
          const error = denied.has(tool.toolCallId) ? options.deniedText : toolOutputText(tool);
          send({ toolResult: { id: tool.toolCallId, name: entry.name, error } });
        }
        return;
      }
      default:
        options.onOther?.(update);
        return;
    }
  };

  return {
    onUpdate,
    markDenied: (toolCallId) => void denied.add(toolCallId),
    get hasText() {
      return hasText;
    },
  };
}
