export const fileTokenGroupI18nStrings = {
  limitShowFewer: 'Show fewer files',
  limitShowMore: 'Show more files',
  errorIconAriaLabel: 'Error',
  warningIconAriaLabel: 'Warning',
  removeFileAriaLabel: (fileIndex: number) => `Remove file ${fileIndex + 1}`,
  formatFileSize: (sizeInBytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = sizeInBytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  },
  formatFileLastModified: (date: Date) => {
    return date.toLocaleDateString();
  },
};
