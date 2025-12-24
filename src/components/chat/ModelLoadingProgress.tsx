import { useEffect, useState } from 'react';

import { Box, Button, Modal, SpaceBetween, Spinner } from '@cloudscape-design/components';

export interface ModelLoadingProgressProps {
  visible: boolean;
  modelName: string;
  onCancel: () => void;
}

export default function ModelLoadingProgress({
  visible,
  modelName,
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

  return (
    <Modal
      visible={visible}
      onDismiss={onCancel}
      header={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <img src="/lmstudio_icon.svg" alt="LM Studio" style={{ width: '24px', height: '24px' }} />
          <span>Loading Model</span>
        </SpaceBetween>
      }
      footer={
        <Box float="right">
          <Button variant="link" onClick={onCancel}>
            Cancel
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <Box>
          <SpaceBetween size="xs">
            <Box variant="h3">{modelName}</Box>
            <Box color="text-body-secondary">Please wait while the model loads...</Box>
          </SpaceBetween>
        </Box>

        <Box textAlign="center" padding="l">
          <Spinner size="large" />
        </Box>

        <Box textAlign="center">
          <Box color="text-body-secondary" fontSize="body-s">
            Elapsed time: {elapsedTime}s
          </Box>
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
