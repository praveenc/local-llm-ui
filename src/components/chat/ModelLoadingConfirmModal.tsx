import { Box, Button, Modal, SpaceBetween } from '@cloudscape-design/components';

export interface ModelLoadingConfirmModalProps {
  visible: boolean;
  modelName: string;
  modelArchitecture?: string;
  modelParams?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ModelLoadingConfirmModal({
  visible,
  modelName,
  modelArchitecture,
  modelParams,
  onConfirm,
  onCancel,
}: ModelLoadingConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      onDismiss={onCancel}
      header={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <img src="/lmstudio_icon.svg" alt="LM Studio" style={{ width: '24px', height: '24px' }} />
          <span>Load Model?</span>
        </SpaceBetween>
      }
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm}>
              Load Model
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          Do you want to load <strong>{modelName}</strong>?
        </Box>

        {(modelArchitecture || modelParams) && (
          <Box variant="awsui-key-label">
            <SpaceBetween size="xs">
              {modelArchitecture && (
                <div>
                  <Box variant="awsui-key-label">Architecture</Box>
                  <div>{modelArchitecture}</div>
                </div>
              )}
              {modelParams && (
                <div>
                  <Box variant="awsui-key-label">Parameters</Box>
                  <div>{modelParams}</div>
                </div>
              )}
            </SpaceBetween>
          </Box>
        )}

        <Box variant="p" color="text-body-secondary">
          This may take 5-15 seconds depending on the model size. You'll see a progress bar during
          the loading process.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
