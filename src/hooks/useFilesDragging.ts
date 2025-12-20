import { useCallback, useState } from 'react';

interface UseFilesDraggingReturn {
  isDragging: boolean;
  areFilesDragging: boolean;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, onFilesChange?: (files: File[]) => void) => void;
}

const useFilesDragging = (): UseFilesDraggingReturn => {
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, onFilesChange?: (files: File[]) => void) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (onFilesChange) {
      onFilesChange(files);
    }
  }, []);

  return {
    isDragging,
    areFilesDragging: isDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
};

export default useFilesDragging;
