// File upload utilities for Bedrock Converse API

const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5 MB in bytes
const MAX_FILES_PER_REQUEST = 5;

const SUPPORTED_FORMATS = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;

type SupportedFormat = (typeof SUPPORTED_FORMATS)[keyof typeof SUPPORTED_FORMATS];

/**
 * Text-like MIME types that should be normalized to 'text/plain' for Bedrock.
 * These are code, scripts, configs, and data formats that are fundamentally text.
 */
const TEXT_LIKE_MIME_TYPES = new Set([
  // text/* variants not already in SUPPORTED_FORMATS
  'text/x-python',
  'text/x-script.python',
  'text/javascript',
  'text/x-javascript',
  'text/typescript',
  'text/x-typescript',
  'text/x-sh',
  'text/x-bash',
  'text/x-zsh',
  'text/x-ruby',
  'text/x-perl',
  'text/xml',
  'text/x-yaml',
  'text/x-log',
  'text/x-csrc',
  'text/x-c',
  'text/x-c++src',
  'text/x-java-source',
  'text/x-makefile',
  'text/x-diff',
  'text/x-patch',
  'text/x-ini',
  'text/x-toml',
  // application/* types that are actually text
  'application/x-sh',
  'application/x-csh',
  'application/x-bash',
  'application/x-python',
  'application/x-python-code',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/json',
  'application/xml',
  'application/x-xml',
  'application/x-yaml',
  'application/yaml',
  'application/x-perl',
  'application/x-ruby',
  'application/x-php',
  'application/x-httpd-php',
  'application/x-awk',
  'application/x-sed',
  'application/x-tcl',
  'application/x-lua',
  'application/x-powershell',
  'application/x-bat',
  'application/x-msdos-program',
  'application/x-env',
  'application/x-makefile',
  'application/x-dockerfile',
  'application/x-toml',
]);

/**
 * Bedrock Converse API supported document MIME types (authoritative list from @ai-sdk/amazon-bedrock).
 */
const BEDROCK_SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/html',
  'text/plain',
  'text/markdown',
]);

/**
 * Normalizes a browser MIME type to a Bedrock-supported MIME type.
 * Returns the normalized MIME type, or null if truly unsupported (binary).
 */
export function normalizeMediaType(mimeType: string): string | null {
  if (BEDROCK_SUPPORTED_MIME_TYPES.has(mimeType)) return mimeType;
  if (TEXT_LIKE_MIME_TYPES.has(mimeType)) return 'text/plain';
  if (mimeType.startsWith('text/')) return 'text/plain';
  if (mimeType.startsWith('image/')) return mimeType; // images handled separately
  return null;
}

export interface FileValidationError {
  file: File;
  error: string;
}

export interface ProcessedFile {
  name: string;
  format: SupportedFormat;
  bytes: string; // base64 encoded
  size: number;
}

/**
 * Sanitizes filename according to Bedrock requirements:
 * - Only alphanumeric characters
 * - Whitespace characters (no more than one in a row)
 * - Hyphens
 * - Parentheses
 * - Square brackets
 * - Maximum length of 200 characters
 * - Minimum length of 1 character
 *
 * Note: This field is vulnerable to prompt injections, so we use neutral names.
 */
export function sanitizeFilename(filename: string): string {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // Replace multiple spaces with single space
  let sanitized = nameWithoutExt.replace(/\s+/g, ' ');

  // Keep only allowed characters: alphanumeric, space, hyphen, parentheses, square brackets
  sanitized = sanitized.replace(/[^a-zA-Z0-9 \-()[\]]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // If empty after sanitization, use a default name
  if (!sanitized) {
    sanitized = 'document';
  }

  // Enforce maximum length of 200 characters
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200).trim();
  }

  return sanitized;
}

/**
 * Gets the format string for a file based on its MIME type
 */
export function getFileFormat(file: File): SupportedFormat | null {
  // Check MIME type
  if (file.type in SUPPORTED_FORMATS) {
    return SUPPORTED_FORMATS[file.type as keyof typeof SUPPORTED_FORMATS];
  }

  // Fallback to file extension
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension) {
    const formatValues = Object.values(SUPPORTED_FORMATS);
    if (formatValues.includes(extension as SupportedFormat)) {
      return extension as SupportedFormat;
    }
  }

  return null;
}

/**
 * Validates a single file
 */
export function validateFile(file: File): string | null {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return `File "${file.name}" exceeds the maximum size of 4.5 MB (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  }

  // Check file format
  const format = getFileFormat(file);
  if (!format) {
    return `File "${file.name}" has an unsupported format. Supported formats: PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX`;
  }

  return null;
}

/**
 * Validates an array of files
 */
export function validateFiles(files: File[]): FileValidationError[] {
  const errors: FileValidationError[] = [];

  // Check number of files
  if (files.length > MAX_FILES_PER_REQUEST) {
    errors.push({
      file: files[0],
      error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} files per request (${files.length} provided)`,
    });
    return errors;
  }

  // Validate each file
  for (const file of files) {
    const error = validateFile(file);
    if (error) {
      errors.push({ file, error });
    }
  }

  return errors;
}

/**
 * Converts a File to base64 string
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Processes files for Bedrock Converse API
 */
export async function processFilesForBedrock(files: File[]): Promise<{
  processedFiles: ProcessedFile[];
  errors: FileValidationError[];
}> {
  // Validate files first
  const validationErrors = validateFiles(files);
  if (validationErrors.length > 0) {
    return { processedFiles: [], errors: validationErrors };
  }

  // Process each file
  const processedFiles: ProcessedFile[] = [];
  const errors: FileValidationError[] = [];

  for (const file of files) {
    try {
      const format = getFileFormat(file);
      if (!format) {
        errors.push({
          file,
          error: `Unsupported file format: ${file.type}`,
        });
        continue;
      }

      const bytes = await fileToBase64(file);
      const sanitizedName = sanitizeFilename(file.name);

      processedFiles.push({
        name: sanitizedName,
        format,
        bytes,
        size: file.size,
      });
    } catch (error) {
      errors.push({
        file,
        error: error instanceof Error ? error.message : 'Failed to process file',
      });
    }
  }

  return { processedFiles, errors };
}
