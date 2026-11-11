// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createThinkTagSplitter } from '../think-tags';
import type { ThinkPart } from '../think-tags';

/** Feed chunks, then flush. Returns the parts of each push and the flush as one flat list. */
function run(chunks: string[]): ThinkPart[] {
  const splitter = createThinkTagSplitter();
  return [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.flush()];
}

/** Join all text by type */
function totals(parts: ThinkPart[]): { reasoning: string; content: string } {
  const result = { reasoning: '', content: '' };
  for (const part of parts) result[part.type] += part.text;
  return result;
}

/** Small seeded generator, so a failure can be repeated */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function splitRandomly(text: string, random: () => number): string[] {
  const chunks: string[] = [];
  let position = 0;
  while (position < text.length) {
    const size = 1 + Math.floor(random() * 9);
    chunks.push(text.slice(position, position + size));
    position += size;
  }
  return chunks;
}

describe('createThinkTagSplitter', () => {
  it('passes plain text through as content', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('Hello world')).toEqual([{ type: 'content', text: 'Hello world' }]);
    expect(splitter.flush()).toEqual([]);
  });

  it('splits one block that arrives in one chunk', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('Before <think>deep</think> after')).toEqual([
      { type: 'content', text: 'Before ' },
      { type: 'reasoning', text: 'deep' },
      { type: 'content', text: ' after' },
    ]);
    expect(splitter.flush()).toEqual([]);
  });

  it('handles tags split across chunks', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('Hello <thi')).toEqual([{ type: 'content', text: 'Hello ' }]);
    expect(splitter.push('nk>deep</thi')).toEqual([{ type: 'reasoning', text: 'deep' }]);
    expect(splitter.push('nk> world')).toEqual([{ type: 'content', text: ' world' }]);
    expect(splitter.flush()).toEqual([]);
  });

  it('handles two blocks in one reply', () => {
    const parts = run(['<think>one</think>A', '<think>two</think>B']);
    expect(parts).toEqual([
      { type: 'reasoning', text: 'one' },
      { type: 'content', text: 'A' },
      { type: 'reasoning', text: 'two' },
      { type: 'content', text: 'B' },
    ]);
  });

  it('treats everything after an unclosed block as reasoning', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('Hi <think>still thinking')).toEqual([
      { type: 'content', text: 'Hi ' },
      { type: 'reasoning', text: 'still thinking' },
    ]);
    expect(splitter.push(' and more')).toEqual([{ type: 'reasoning', text: ' and more' }]);
    expect(splitter.flush()).toEqual([]);
  });

  it('releases a lone "<" that is not a tag with the next chunk', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('a <')).toEqual([{ type: 'content', text: 'a ' }]);
    expect(splitter.push(' b')).toEqual([{ type: 'content', text: '< b' }]);
    expect(splitter.flush()).toEqual([]);
  });

  it('emits "a < b" as content when it arrives in one chunk', () => {
    expect(run(['a < b'])).toEqual([{ type: 'content', text: 'a < b' }]);
  });

  it('flush releases a held partial tag as content', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('x <thi')).toEqual([{ type: 'content', text: 'x ' }]);
    expect(splitter.flush()).toEqual([{ type: 'content', text: '<thi' }]);
    expect(splitter.flush()).toEqual([]);
  });

  it('flush releases a held partial closing tag as reasoning', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.push('<think>idea</thi')).toEqual([{ type: 'reasoning', text: 'idea' }]);
    expect(splitter.flush()).toEqual([{ type: 'reasoning', text: '</thi' }]);
  });

  it('does not emit empty strings', () => {
    const parts = run(['<think>', '</think>', '', 'text']);
    expect(parts).toEqual([{ type: 'content', text: 'text' }]);
  });

  it('merges adjacent parts of the same type in one push', () => {
    const splitter = createThinkTagSplitter();
    // The block is empty, so the two content pieces around it become one part
    expect(splitter.push('a<think></think>b')).toEqual([{ type: 'content', text: 'ab' }]);
  });

  it('keeps a "</think>" in answer text as content', () => {
    expect(run(['done </think> ok'])).toEqual([{ type: 'content', text: 'done </think> ok' }]);
  });

  it('gives the same text by type for any chunk size', () => {
    const samples = [
      'plain text with < and > but no tags',
      'Hello <think>deep thoughts</think> world',
      '<think>a</think>b<think>c</think>d',
      'start <think>never closed <thi and </thi',
      'x <thin y <think>r</think> z </think> end <',
      '<<think>><think>nested <think>x</think>y</think>',
    ];
    const random = seededRandom(42);

    for (const sample of samples) {
      const expected = totals(run([sample]));
      for (let attempt = 0; attempt < 50; attempt++) {
        const chunks = splitRandomly(sample, random);
        expect(totals(run(chunks)), JSON.stringify(chunks)).toEqual(expected);
      }
    }
  });
});
