// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { SessionUpdate } from '../acp/types.ts';
import { MAX_TOOL_OUTPUT, createUpdateMapper, toolOutputText } from '../acp/updates.ts';
import type { AcpStreamEvent } from '../acp/updates.ts';

function setup() {
  const events: AcpStreamEvent[] = [];
  const other: SessionUpdate[] = [];
  const mapper = createUpdateMapper({
    send: (e) => void events.push(e),
    toolName: (u) => u.kind ?? 'tool',
    deniedText: 'DENIED',
    onOther: (u) => void other.push(u),
  });
  return { events, other, mapper };
}

const textItem = (text: string) => ({ type: 'content', content: { type: 'text', text } });

describe('createUpdateMapper', () => {
  it('sends text and reasoning chunks', () => {
    const { events, mapper } = setup();
    expect(mapper.hasText).toBe(false);
    mapper.onUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'hm' },
    });
    expect(mapper.hasText).toBe(false);
    mapper.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } });
    expect(mapper.hasText).toBe(false);
    mapper.onUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    });
    mapper.onUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'x' },
    });
    expect(mapper.hasText).toBe(true);
    expect(events).toEqual([{ reasoning: 'hm' }, { content: '' }, { content: 'hi' }]);
  });

  it('announces a tool call once and sends its result once', () => {
    const { events, mapper } = setup();
    mapper.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      kind: 'read',
      status: 'pending',
      rawInput: { path: 'a' },
    });
    mapper.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });
    mapper.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [textItem('one'), textItem('two')],
    });
    mapper.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(events).toEqual([
      { toolCall: { id: 't1', name: 'read', args: { path: 'a' } } },
      { toolResult: { id: 't1', name: 'read', result: 'one\n\ntwo' } },
    ]);
  });

  it('sends a failed tool with its output, and a denied one with deniedText', () => {
    const { events, mapper } = setup();
    mapper.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 'f', kind: 'execute' });
    mapper.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'f',
      status: 'failed',
      rawOutput: 'boom',
    });
    mapper.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 'd', kind: 'edit' });
    mapper.markDenied('d');
    mapper.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'd',
      status: 'failed',
      rawOutput: 'rejected',
    });
    expect(events.slice(1, 2)).toEqual([
      { toolResult: { id: 'f', name: 'execute', error: 'boom' } },
    ]);
    expect(events.at(-1)).toEqual({ toolResult: { id: 'd', name: 'edit', error: 'DENIED' } });
  });

  it('announces and ends a tool call that arrives completed or only as an update', () => {
    const { events, mapper } = setup();
    mapper.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c',
      kind: 'fetch',
      status: 'completed',
      rawOutput: { ok: 1 },
    });
    mapper.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'u', status: 'completed' });
    mapper.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: '', status: 'completed' });
    expect(events).toEqual([
      { toolCall: { id: 'c', name: 'fetch', args: {} } },
      { toolResult: { id: 'c', name: 'fetch', result: '{"ok":1}' } },
      { toolCall: { id: 'u', name: 'tool', args: {} } },
      { toolResult: { id: 'u', name: 'tool', result: '' } },
    ]);
  });

  it('passes every other kind to onOther', () => {
    const { events, other, mapper } = setup();
    const info = { sessionUpdate: 'session_info_update', _meta: { x: 1 } };
    const commands = { sessionUpdate: 'available_commands_update', availableCommands: [] };
    const unknown = { sessionUpdate: 'something_new' };
    for (const u of [info, commands, unknown]) mapper.onUpdate(u);
    expect(events).toEqual([]);
    expect(other).toEqual([info, commands, unknown]);
  });
});

describe('toolOutputText', () => {
  it('reads text content, then rawOutput, and cuts it', () => {
    expect(toolOutputText({ content: [textItem('a'), { type: 'diff' }], rawOutput: 'r' })).toBe(
      'a'
    );
    expect(toolOutputText({ rawOutput: 'r' })).toBe('r');
    expect(toolOutputText({})).toBe('');
    expect(toolOutputText({ rawOutput: [1] })).toBe('[1]');
    expect(toolOutputText({ rawOutput: 'x'.repeat(MAX_TOOL_OUTPUT + 5) })).toHaveLength(
      MAX_TOOL_OUTPUT
    );
  });
});
