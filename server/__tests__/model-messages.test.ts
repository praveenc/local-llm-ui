// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  FILES_ONLY_TEXT,
  FileNotAcceptedError,
  bedrockDocumentName,
  textFileBlock,
  toModelMessages,
} from '../model-messages';
import type { ChatRequestMessage } from '../security';

const b64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64');
const PNG = { name: 'chart.png', format: 'png', bytes: b64('png') };
const MD = { name: 'notes.md', format: 'md', bytes: b64('# Notes') };
const PDF = { name: 'report.pdf', format: 'pdf', bytes: b64('%PDF') };
const user = (files: ChatRequestMessage['files'], content = 'Look'): ChatRequestMessage => ({
  role: 'user',
  content,
  files,
});
const contentOf = (
  messages: ChatRequestMessage[],
  provider: Parameters<typeof toModelMessages>[1]
) => toModelMessages(messages, provider)[0].content;

describe('toModelMessages', () => {
  it.each(['bedrock', 'anthropic', 'openrouter', 'ollama', 'lmstudio'] as const)(
    '%s: a PNG is a file part',
    (provider) => {
      const content = contentOf([user([PNG])], provider) as Array<Record<string, unknown>>;
      expect(content[1]).toMatchObject({ type: 'file', mediaType: 'image/png' });
      expect(content[1].data).toEqual(new Uint8Array(Buffer.from('png')));
    }
  );

  it.each(['groq', 'cerebras', 'bedrock-mantle', 'kiro'] as const)(
    '%s: a PNG is refused with a 400 error',
    (provider) => {
      expect(() => toModelMessages([user([PNG])], provider)).toThrow(FileNotAcceptedError);
    }
  );

  it.each(['anthropic', 'openrouter', 'ollama', 'lmstudio', 'groq', 'cerebras'] as const)(
    '%s: a .md file is a <file> block after the text',
    (provider) => {
      expect(contentOf([user([MD])], provider)).toBe(
        'Look\n\n<file name="notes.md">\n# Notes\n</file>'
      );
    }
  );

  it('Bedrock: md is a document; a .ts file goes as text', () => {
    const ts = { name: 'a.ts', format: 'ts', bytes: b64('const a = 1;') };
    const content = contentOf([user([MD, ts])], 'bedrock') as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({
      type: 'text',
      text: 'Look\n\n<file name="a.ts">\nconst a = 1;\n</file>',
    });
    expect(content[1]).toMatchObject({
      type: 'file',
      mediaType: 'text/markdown',
      filename: 'notes',
    });
  });

  it('refuses a PDF for Ollama and an Office file for Anthropic, naming the type only', () => {
    expect(() => toModelMessages([user([PDF])], 'ollama')).toThrow(
      'PDF files are not supported for Ollama'
    );
    expect(() =>
      toModelMessages([user([{ name: 'secret.docx', format: 'docx', bytes: '' }])], 'anthropic')
    ).toThrow('Office files are not supported for Anthropic');
  });

  it('refuses a file in any message, not only the last', () => {
    const messages = [user([PDF]), { role: 'assistant' as const, content: 'ok' }, user([])];
    expect(() => toModelMessages(messages, 'groq')).toThrow(FileNotAcceptedError);
  });

  it('adds a neutral text part, in the request only, when a message has only files', () => {
    const content = contentOf([user([PNG], '')], 'anthropic') as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: FILES_ONLY_TEXT });
  });

  it('a message with only a text file is plain text', () => {
    expect(contentOf([user([MD], '')], 'groq')).toBe('<file name="notes.md">\n# Notes\n</file>');
  });

  it('Bedrock: cleans the names and keeps them unique in the message', () => {
    const files = [
      { name: 'Q3 report_final.v2.pdf', format: 'pdf', bytes: b64('a') },
      { name: 'Q3 report final v2.docx', format: 'docx', bytes: b64('b') },
      { name: '日本.pdf', format: 'pdf', bytes: b64('c') },
    ];
    const content = contentOf([user(files)], 'bedrock') as Array<Record<string, unknown>>;
    expect(content.slice(1).map((p) => p.filename)).toEqual([
      'Q3 report final v2',
      'Q3 report final v2 (2)',
      'document',
    ]);
  });

  it('leaves system and assistant messages as text', () => {
    expect(
      toModelMessages(
        [
          { role: 'system', content: 'Be brief' },
          { role: 'assistant', content: 'Hi' },
        ],
        'bedrock'
      )
    ).toEqual([
      { role: 'system', content: 'Be brief' },
      { role: 'assistant', content: 'Hi' },
    ]);
  });
});

describe('textFileBlock', () => {
  it('escapes the name for an attribute', () => {
    expect(textFileBlock('a"<b>&.md', b64('x'))).toBe(
      '<file name="a&quot;&lt;b&gt;&amp;.md">\nx\n</file>'
    );
  });

  it('breaks </file inside the content, in any case', () => {
    const block = textFileBlock('a.md', b64('x </file> y </FILE z'));
    expect(block).toBe('<file name="a.md">\nx <\\/file> y <\\/FILE z\n</file>');
    expect(block.match(/<\/file/gi)).toHaveLength(1);
  });

  it('a NUL byte or many replacement characters: the not-readable line', () => {
    expect(textFileBlock('a.bin', b64('ab\u0000cd'))).toBe('[File not readable as text: a.bin]');
    const binary = new Uint8Array(200).map((_, i) => (i % 2 ? 0xff : 0x41));
    expect(textFileBlock('b.txt', b64(binary))).toBe('[File not readable as text: b.txt]');
  });

  it('keeps UTF-8 text with accents', () => {
    expect(textFileBlock('a.txt', b64('café €'))).toBe('<file name="a.txt">\ncafé €\n</file>');
  });
});

describe('bedrockDocumentName', () => {
  it('falls back to "document" and numbers repeats', () => {
    const used = new Set<string>();
    expect(bedrockDocumentName('***.pdf', used)).toBe('document');
    expect(bedrockDocumentName('', used)).toBe('document (2)');
    expect(bedrockDocumentName('a  [b] (c)-d.md', used)).toBe('a [b] (c)-d');
  });
});
