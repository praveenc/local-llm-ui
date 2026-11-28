/**
 * File format <-> media type map for attachments.
 *
 * Shared by the browser and the server proxies. The "format" is the short name that the chat
 * sends with a file (pdf, txt, png, ...). It matches the Bedrock Converse document formats.
 */

export const MEDIA_TYPE_BY_FORMAT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  md: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  // Text files that go into the message text (src/utils/attachments.ts)
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/x-typescript',
  tsx: 'text/x-tsx',
  jsx: 'text/x-jsx',
  py: 'text/x-python',
  java: 'text/x-java',
  go: 'text/x-go',
  rs: 'text/x-rust',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  sh: 'application/x-sh',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  sql: 'application/sql',
};

/** The formats that a media type maps back to: one format for each media type */
const REVERSE_FORMATS = [
  'pdf',
  'txt',
  'html',
  'md',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'png',
  'jpg', // jpg and jpeg share a media type; keep jpg
  'gif',
  'webp',
];

const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, string>> = Object.fromEntries(
  REVERSE_FORMATS.map((format) => [MEDIA_TYPE_BY_FORMAT[format], format])
);

/** The media type for a format, or undefined for a format that is not in the map */
export const lookupMediaType = (format: string): string | undefined =>
  MEDIA_TYPE_BY_FORMAT[format.toLowerCase()];

/** The media type for a format. Unknown formats are binary. */
export const getMediaTypeFromFormat = (format: string): string =>
  lookupMediaType(format) ?? 'application/octet-stream';

/** The format for a media type that is in the map, or undefined */
export const lookupFormat = (mediaType: string): string | undefined =>
  FORMAT_BY_MEDIA_TYPE[mediaType];
