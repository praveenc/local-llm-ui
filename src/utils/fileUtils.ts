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
