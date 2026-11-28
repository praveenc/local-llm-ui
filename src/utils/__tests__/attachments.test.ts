import { describe, expect, it } from 'vitest';

import {
  MAX_DOCUMENTS_PER_MESSAGE,
  MAX_FILE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_FILE_BYTES,
  acceptList,
  acceptsAnyFile,
  classifyFile,
  fileAccepts,
  hasUnsafeNameCharacter,
  messageLimitReason,
  noModelReason,
  notAcceptedReason,
  quoteFileName,
} from '../attachments';

describe('classifyFile', () => {
  it.each([
    ['a.png', 'image/png', 'image', 'png'],
    ['a.jpeg', 'image/jpeg', 'image', 'jpg'],
    ['a.jpg', 'image/jpeg', 'image', 'jpg'],
    ['a.gif', 'image/gif', 'image', 'gif'],
    ['a.webp', 'image/webp', 'image', 'webp'],
    ['a.pdf', 'application/pdf', 'pdf', 'pdf'],
    ['a.docx', '', 'office', 'docx'],
    ['a.xls', 'application/vnd.ms-excel', 'office', 'xls'],
    ['a.md', '', 'text', 'md'],
    ['a.csv', 'text/csv', 'text', 'csv'],
    ['a.json', 'application/json', 'text', 'json'],
    // Browsers call .ts an MPEG stream: the extension wins
    ['a.ts', 'video/mp2t', 'text', 'ts'],
    ['a.yml', '', 'text', 'yml'],
    ['Makefile', 'text/plain', 'text', 'txt'],
  ])('%s (%s) is %s, format %s', (name, type, kind, format) => {
    expect(classifyFile(name, type)).toEqual({ kind, format });
  });

  it.each([
    ['logo.svg', 'image/svg+xml'],
    ['photo.heic', 'image/heic'],
    ['scan.bmp', 'image/bmp'],
    ['scan.tiff', 'image/tiff'],
    // A known extension does not make an SVG an image that the app sends
    ['logo.png', 'image/svg+xml'],
  ])('refuses the image %s with a reason in words', (name, type) => {
    const result = classifyFile(name, type);
    expect(result.kind).toBe('unsupported');
    expect(result.reason).toBe(
      `${name} is not a PNG, JPEG, GIF, or WebP image. Convert it to one of these.`
    );
  });

  it('refuses a binary file with no known type', () => {
    expect(classifyFile('a.exe', 'application/x-msdownload')).toEqual({
      kind: 'unsupported',
      reason: 'a.exe is not a file type that the app can send.',
    });
  });
});

describe('fileAccepts', () => {
  const all = { images: true, pdf: true, office: true, text: true };
  it.each([
    ['bedrock', {}, all],
    ['anthropic', {}, { images: true, pdf: true, office: false, text: true }],
    ['openrouter', {}, { images: false, pdf: true, office: false, text: true }],
    ['openrouter', { vision: true }, { images: true, pdf: true, office: false, text: true }],
    ['ollama', {}, { images: false, pdf: false, office: false, text: true }],
    ['ollama', { vision: true }, { images: true, pdf: false, office: false, text: true }],
    ['lmstudio', { vision: true }, { images: true, pdf: false, office: false, text: true }],
    ['groq', { vision: true }, { images: false, pdf: false, office: false, text: true }],
    ['cerebras', {}, { images: false, pdf: false, office: false, text: true }],
    ['bedrock-mantle', {}, { images: false, pdf: false, office: false, text: false }],
    ['kiro', {}, { images: false, pdf: false, office: false, text: false }],
    [undefined, {}, { images: false, pdf: false, office: false, text: false }],
  ] as const)('%s %o', (provider, flags, expected) => {
    expect(fileAccepts(provider, flags)).toEqual(expected);
  });

  it('a model that takes no type has no file at all', () => {
    expect(acceptsAnyFile(fileAccepts('bedrock-mantle'))).toBe(false);
    expect(acceptsAnyFile(fileAccepts('groq'))).toBe(true);
  });

  it('the accept list follows the model', () => {
    expect(acceptList(fileAccepts('groq'))).not.toContain('image');
    expect(acceptList(fileAccepts('groq'))).not.toContain('.pdf');
    expect(acceptList(fileAccepts('groq'))).toContain('.md');
    expect(acceptList(fileAccepts('anthropic'))).toContain('image/png');
    expect(acceptList(fileAccepts('anthropic'))).not.toContain('image/*');
    expect(acceptList(fileAccepts('kiro'))).toBe('');
  });
});

describe('notAcceptedReason', () => {
  it('names the provider, what it reads, and the file', () => {
    expect(notAcceptedReason('groq', fileAccepts('groq'), 'report.pdf', 'pdf')).toBe(
      'Groq models read text files only. report.pdf is a PDF.'
    );
    expect(notAcceptedReason('anthropic', fileAccepts('anthropic'), 'a.docx', 'office')).toBe(
      'Anthropic models read images, PDFs, and text files. a.docx is an Office file.'
    );
  });

  it('speaks of this model when images depend on the model list', () => {
    expect(notAcceptedReason('ollama', fileAccepts('ollama'), 'a.png', 'image')).toBe(
      'This model reads text files only. a.png is an image.'
    );
  });
});

describe('messageLimitReason', () => {
  const images = (n: number) =>
    Array.from({ length: n }, () => ({ kind: 'image' as const, size: 1 }));
  const docs = (n: number) => Array.from({ length: n }, () => ({ kind: 'pdf' as const, size: 1 }));

  it('has the D-H limits', () => {
    expect(MAX_FILE_BYTES).toBe(4.5 * 1024 * 1024);
    expect(MAX_IMAGES_PER_MESSAGE).toBe(20);
    expect(MAX_DOCUMENTS_PER_MESSAGE).toBe(5);
    expect(MAX_MESSAGE_FILE_BYTES).toBe(7.5 * 1024 * 1024);
  });

  it('takes 20 images and 5 documents', () => {
    expect(messageLimitReason([...images(20), ...docs(5)])).toBeNull();
  });

  it('refuses the 21st image, the 6th document, and more than 7.5 MB', () => {
    expect(messageLimitReason(images(21))).toBe('A message can have at most 20 images.');
    expect(messageLimitReason(docs(6))).toBe(
      'A message can have at most 5 files that are not images.'
    );
    expect(
      messageLimitReason([
        { kind: 'pdf', size: 4 * 1024 * 1024 },
        { kind: 'text', size: 4 * 1024 * 1024 },
      ])
    ).toBe('The files of a message can be at most 7.5 MB together.');
  });
});

describe('file names', () => {
  it.each([
    ['a C0 control', 'a\nb.pdf'],
    ['a C1 control', 'a\u0085b.pdf'],
    ['U+2028', 'a\u2028b.pdf'],
    ['U+2029', 'a\u2029b.pdf'],
    ['U+202A', 'a\u202Ab.pdf'],
    ['U+202E', 'a\u202Eb.pdf'],
    ['U+2066', 'a\u2066b.pdf'],
    ['U+2069', 'a\u2069b.pdf'],
  ])('refuses %s in a name', (_name, name) => {
    expect(hasUnsafeNameCharacter(name)).toBe(true);
  });

  it('takes a plain name, accents, and other Unicode', () => {
    expect(hasUnsafeNameCharacter('Café report (2) €.pdf')).toBe(false);
    expect(hasUnsafeNameCharacter('a\u2027b\u206Ac.pdf')).toBe(false);
  });

  it('quotes a name as a JSON string', () => {
    expect(quoteFileName('a.pdf')).toBe('"a.pdf"');
    expect(quoteFileName('a"] b.pdf')).toBe('"a\\"] b.pdf"');
  });

  it('says the same words with no model, for one file and for several', () => {
    expect(noModelReason(['a.pdf'])).toBe(
      'With no model selected, the chat cannot read a.pdf. Pick a model to send it.'
    );
    expect(noModelReason(['a.pdf', 'b.md'])).toBe(
      'With no model selected, the chat cannot read a.pdf and b.md. Pick a model to send them.'
    );
    expect(notAcceptedReason(undefined, fileAccepts(undefined), 'a.pdf', 'pdf')).toBe(
      noModelReason(['a.pdf'])
    );
  });
});
