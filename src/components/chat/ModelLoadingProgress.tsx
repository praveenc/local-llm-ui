import { useEffect, useState } from 'react';

import {
  Box,
  Button,
  Modal,
  ProgressBar,
  SpaceBetween,
  StatusIndicator,
} from '@cloudscape-design/components';

export interface ModelLoadingProgressProps {
  visible: boolean;
  modelName: string;
  progress: number;
  message: string;
  onCancel: () => void;
}

export default function ModelLoadingProgress({
  visible,
  modelName,
  progress,
  message,
  onCancel,
}: ModelLoadingProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!visible) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [visible]);

  const canCancel = progress < 90;

  return (
    <Modal
      visible={visible}
      onDismiss={canCancel ? onCancel : undefined}
      header={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <img src="/lmstudio_icon.svg" alt="LM Studio" style={{ width: '24px', height: '24px' }} />
          <span>Loading Model</span>
        </SpaceBetween>
      }
      footer={
        canCancel ? (
          <Box float="right">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
          </Box>
        ) : null
      }
    >
      <SpaceBetween size="l">
        <Box>
          <SpaceBetween size="xs">
            <Box variant="h3">{modelName}</Box>
            <Box color="text-body-secondary">Please wait while the model loads...</Box>
          </SpaceBetween>
        </Box>

        <div>
          <ProgressBar value={progress} variant="standalone" />
        </div>

        <Box>
          <SpaceBetween size="xs">
            <div>
              <StatusIndicator type="loading">{progress.toFixed(1)}% complete</StatusIndicator>
            </div>
            {message && (
              <Box color="text-body-secondary" fontSize="body-s">
                {message}
              </Box>
            )}
            <Box color="text-body-secondary" fontSize="body-s">
              Elapsed time: {elapsedTime}s
            </Box>
          </SpaceBetween>
        </Box>

        {!canCancel && (
          <Box variant="p" color="text-body-secondary" fontSize="body-s">
            Almost done! Please wait...
          </Box>
        )}
      </SpaceBetween>
    </Modal>
  );
}
