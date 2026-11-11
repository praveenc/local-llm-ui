/**
 * Splits streamed text into reasoning and answer text.
 *
 * Some models (DeepSeek, Qwen3 and others) write their thinking inline, between `<think>` and
 * `</think>`. The splitter is a small state machine, so each chunk costs work in proportion to
 * its own size. A tag can arrive split across chunks ("<thi" + "nk>"), so a trailing partial
 * tag is held back until the next chunk shows what it is.
 */

export interface ThinkPart {
  type: 'reasoning' | 'content';
  text: string;
}

/** Splits streamed text into reasoning (inside <think>...</think>) and answer text */
export interface ThinkTagSplitter {
  /** Feed one text chunk. Returns the parts to emit, in order. */
  push(chunk: string): ThinkPart[];
  /** Call when the stream ends. Returns text still held back (e.g. a partial "<thi"). */
  flush(): ThinkPart[];
}

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/** Length of the longest tail of `text` that is a proper prefix of `tag` (0 if none) */
function partialTagLength(text: string, tag: string): number {
  const longest = Math.min(tag.length - 1, text.length);
  for (let length = longest; length > 0; length--) {
    if (tag.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

/** Add text to a part list: skip empty text and merge into the last part of the same type */
function addPart(parts: ThinkPart[], type: ThinkPart['type'], text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last?.type === type) last.text += text;
  else parts.push({ type, text });
}

export function createThinkTagSplitter(): ThinkTagSplitter {
  let mode: ThinkPart['type'] = 'content';
  /** A trailing piece that may be the start of the next tag */
  let pending = '';

  return {
    push(chunk) {
      const parts: ThinkPart[] = [];
      const text = pending + chunk;
      pending = '';

      let position = 0;
      for (;;) {
        // Content waits for an opening tag, reasoning waits for a closing tag
        const tag = mode === 'content' ? OPEN_TAG : CLOSE_TAG;
        const tagIndex = text.indexOf(tag, position);

        if (tagIndex !== -1) {
          addPart(parts, mode, text.slice(position, tagIndex));
          mode = mode === 'content' ? 'reasoning' : 'content';
          position = tagIndex + tag.length;
          continue;
        }

        const rest = text.slice(position);
        const held = partialTagLength(rest, tag);
        addPart(parts, mode, rest.slice(0, rest.length - held));
        pending = rest.slice(rest.length - held);
        return parts;
      }
    },

    flush() {
      const parts: ThinkPart[] = [];
      addPart(parts, mode, pending);
      pending = '';
      return parts;
    },
  };
}
