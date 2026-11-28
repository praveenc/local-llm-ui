/**
 * Which files each provider can read, and the limits of a message (D-A c, D-H).
 *
 * Shared by the browser (the composer checks) and the server (`server/model-messages.ts`, the
 * chat request check), so there is one rule. No DOM and no Node imports.
 */
import type { Provider } from '../db/types.ts';

/** What a file is, for the provider table */
export type FileKind = 'image' | 'pdf' | 'office' | 'text' | 'unsupported';

/** The types of file that a model can read */
export interface FileAccepts {
  images: boolean;
  pdf: boolean;
  office: boolean;
  text: boolean;
}

/** What the model list reports about one model */
export interface ModelFileFlags {
  /** Ollama `vision`, LM Studio SDK `vision`, OpenRouter `image` in `input_modalities` */
  vision?: boolean;
}

/** The most bytes of one file (D-H) */
export const MAX_FILE_BYTES = 4.5 * 1024 * 1024;
/** The most documents (every file that is not an image) in one message (D-H) */
export const MAX_DOCUMENTS_PER_MESSAGE = 5;
/** The most images in one message (D-H) */
export const MAX_IMAGES_PER_MESSAGE = 20;
/** The most raw bytes of all files of one message (D-H) */
export const MAX_MESSAGE_FILE_BYTES = 7.5 * 1024 * 1024;
/** The most files in one message that the server takes (20 images and 5 documents) */
export const MAX_FILES_PER_MESSAGE = MAX_IMAGES_PER_MESSAGE + MAX_DOCUMENTS_PER_MESSAGE;

/** Image formats that every image-reading provider takes */
export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const OFFICE_FORMATS = ['doc', 'docx', 'xls', 'xlsx'] as const;
/** Text formats: decoded as UTF-8 and put into the message text */
export const TEXT_FORMATS = [
  'txt',
  'md',
  'csv',
  'html',
  'json',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'sh',
  'yaml',
  'yml',
  'toml',
  'xml',
  'sql',
] as const;
/** Text formats that Bedrock reads as documents; other text formats go as text */
export const BEDROCK_TEXT_DOCUMENT_FORMATS = ['txt', 'md', 'csv', 'html'] as const;

/** Every format that a chat request may carry */
export const ALLOWED_FORMATS: readonly string[] = [
  'pdf',
  ...OFFICE_FORMATS,
  ...IMAGE_FORMATS,
  ...TEXT_FORMATS,
];

const IMAGE_SET = new Set<string>(IMAGE_FORMATS);
const OFFICE_SET = new Set<string>(OFFICE_FORMATS);
const TEXT_SET = new Set<string>(TEXT_FORMATS);

/** The kind of a format that the chat sends (`format` of a request file) */
export function kindOfFormat(format: string): FileKind {
  const f = format.toLowerCase();
  if (f === 'pdf') return 'pdf';
  if (IMAGE_SET.has(f)) return 'image';
  if (OFFICE_SET.has(f)) return 'office';
  if (TEXT_SET.has(f)) return 'text';
  return 'unsupported';
}

/** Formats for a media type when the name has no known extension */
const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

const KIND_WORDS: Record<Exclude<FileKind, 'unsupported'>, string> = {
  image: 'an image',
  pdf: 'a PDF',
  office: 'an Office file',
  text: 'a text file',
};

/** The result of `classifyFile` */
export interface FileClass {
  kind: FileKind;
  /** The format that the chat sends; set for every kind but `unsupported` */
  format?: string;
  /** Why the app cannot send the file; set for `unsupported` */
  reason?: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The kind and format of a file from its name and media type. The extension wins, because
 * browsers give odd media types to code files (`.ts` as `video/mp2t`). Images are only png,
 * jpeg, gif, and webp (D-H); any other image type is unsupported.
 */
export function classifyFile(name: string, mediaType: string): FileClass {
  const ext = extensionOf(name);
  const type = mediaType.toLowerCase().split(';')[0].trim();
  const fromExt = ext && kindOfFormat(ext) !== 'unsupported' ? ext : undefined;
  const format = fromExt ?? FORMAT_BY_MEDIA_TYPE[type];
  if (format) {
    // A known extension with an image type that does not match (photo.png that is image/svg+xml)
    if (type.startsWith('image/') && !FORMAT_BY_MEDIA_TYPE[type]) {
      return { kind: 'unsupported', reason: unsupportedImageReason(name) };
    }
    return { kind: kindOfFormat(format), format: format === 'jpeg' ? 'jpg' : format };
  }
  if (type.startsWith('image/'))
    return { kind: 'unsupported', reason: unsupportedImageReason(name) };
  return {
    kind: 'unsupported',
    reason: `${name} is not a file type that the app can send.`,
  };
}

function unsupportedImageReason(name: string): string {
  return `${name} is not a PNG, JPEG, GIF, or WebP image. Convert it to one of these.`;
}

/** What each provider reads (D-A c). `vision` means: only when the model list says so */
type Rule = boolean | 'vision';
const PROVIDER_TABLE: Readonly<
  Record<Provider, { images: Rule; pdf: Rule; office: Rule; text: Rule }>
> = {
  bedrock: { images: true, pdf: true, office: true, text: true },
  anthropic: { images: true, pdf: true, office: false, text: true },
  openrouter: { images: 'vision', pdf: true, office: false, text: true },
  ollama: { images: 'vision', pdf: false, office: false, text: true },
  lmstudio: { images: 'vision', pdf: false, office: false, text: true },
  groq: { images: false, pdf: false, office: false, text: true },
  cerebras: { images: false, pdf: false, office: false, text: true },
  'bedrock-mantle': { images: false, pdf: false, office: false, text: false },
  kiro: { images: false, pdf: false, office: false, text: false },
};

const NOTHING: FileAccepts = { images: false, pdf: false, office: false, text: false };

/** The file types that a model of `provider` reads */
export function fileAccepts(
  provider: Provider | string | undefined,
  flags: ModelFileFlags = {}
): FileAccepts {
  const row = provider ? PROVIDER_TABLE[provider as Provider] : undefined;
  if (!row) return NOTHING;
  const take = (rule: Rule) => (rule === 'vision' ? flags.vision === true : rule);
  return {
    images: take(row.images),
    pdf: take(row.pdf),
    office: take(row.office),
    text: take(row.text),
  };
}

/** True when the model reads one or more types of file */
export const acceptsAnyFile = (accepts: FileAccepts | undefined): boolean =>
  !!accepts && (accepts.images || accepts.pdf || accepts.office || accepts.text);

/** True when `accepts` takes a file of `kind` */
export function acceptsKind(accepts: FileAccepts, kind: FileKind): boolean {
  switch (kind) {
    case 'image':
      return accepts.images;
    case 'pdf':
      return accepts.pdf;
    case 'office':
      return accepts.office;
    case 'text':
      return accepts.text;
    default:
      return false;
  }
}

/** The `accept` list of the file input for a model */
export function acceptList(accepts: FileAccepts): string {
  const items: string[] = [];
  if (accepts.images) items.push('image/png', 'image/jpeg', 'image/gif', 'image/webp');
  if (accepts.pdf) items.push('.pdf');
  if (accepts.office) items.push(...OFFICE_FORMATS.map((f) => `.${f}`));
  if (accepts.text) items.push(...TEXT_FORMATS.map((f) => `.${f}`));
  return items.join(',');
}

const PROVIDER_NAMES: Partial<Record<Provider, string>> = {
  bedrock: 'Amazon Bedrock',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  groq: 'Groq',
  cerebras: 'Cerebras',
  'bedrock-mantle': 'Bedrock Mantle',
  kiro: 'Kiro',
};

/** "images, PDFs, and text files" for what a model reads */
function readsWords(accepts: FileAccepts): string {
  const words: string[] = [];
  if (accepts.images) words.push('images');
  if (accepts.pdf) words.push('PDFs');
  if (accepts.office) words.push('Office files');
  if (accepts.text) words.push('text files');
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')}${words.length > 2 ? ',' : ''} and ${words.at(-1)}`;
}

/**
 * Why a model cannot read a file of `kind`, in words. For example: "Groq models read text
 * files only. report.pdf is a PDF."
 */
export function notAcceptedReason(
  provider: Provider | string | undefined,
  accepts: FileAccepts,
  name: string,
  kind: Exclude<FileKind, 'unsupported'>
): string {
  const row = provider ? PROVIDER_TABLE[provider as Provider] : undefined;
  const providerName = provider ? PROVIDER_NAMES[provider as Provider] : undefined;
  // A rule that depends on the model list is about this model, not every model of the provider
  const dependsOnModel = !!row && Object.values(row).includes('vision');
  const what = `${name} is ${KIND_WORDS[kind]}.`;
  if (!acceptsAnyFile(accepts)) {
    return providerName && !dependsOnModel
      ? `${providerName} models do not take files. ${what}`
      : `This model does not take files. ${what}`;
  }
  const reads = readsWords(accepts);
  const only = reads.includes(' and ') ? '' : ' only';
  const who = providerName && !dependsOnModel ? `${providerName} models read` : 'This model reads';
  return `${who} ${reads}${only}. ${what}`;
}

/** The limits of one message, with the reason in words, or null when the files fit (D-H) */
export function messageLimitReason(files: Array<{ kind: FileKind; size: number }>): string | null {
  const images = files.filter((f) => f.kind === 'image').length;
  const documents = files.length - images;
  if (images > MAX_IMAGES_PER_MESSAGE) {
    return `A message can have at most ${MAX_IMAGES_PER_MESSAGE} images.`;
  }
  if (documents > MAX_DOCUMENTS_PER_MESSAGE) {
    return `A message can have at most ${MAX_DOCUMENTS_PER_MESSAGE} files that are not images.`;
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_MESSAGE_FILE_BYTES) {
    return 'The files of a message can be at most 7.5 MB together.';
  }
  return null;
}

/** The reason for a file over `MAX_FILE_BYTES` */
export const fileTooLargeReason = (name: string): string =>
  `${name} is over 4.5 MB and was not added.`;
