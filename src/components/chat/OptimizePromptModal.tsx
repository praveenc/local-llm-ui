/**
 * Confirmation modal for prompt optimization
 */
import { Box, Button, Modal, SpaceBetween, Spinner } from '@cloudscape-design/components';

interface OptimizePromptModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  isOptimizing: boolean;
}

const OptimizePromptModal = ({
  visible,
  onDismiss,
  onConfirm,
  isOptimizing,
}: OptimizePromptModalProps) => {
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Optimize Prompt"
      closeAriaLabel="Close modal"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={isOptimizing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={isOptimizing}>
              {isOptimizing ? (
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  <Spinner size="normal" />
                  <span>Optimizing...</span>
                </SpaceBetween>
              ) : (
                'Optimize'
              )}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box>
          Your prompt will be sent to <strong>Claude Opus 4.5</strong> for optimization using
          prompting best practices.
        </Box>
        <Box color="text-body-secondary">
          The optimization process analyzes your prompt and rewrites it to be more effective with
          Claude 4.5 models, following Anthropic&apos;s recommended prompting techniques.
        </Box>
        <Box variant="small" color="text-status-info">
          This will replace your current prompt with the optimized version. You can undo this change
          after optimization.
        </Box>
      </SpaceBetween>
    </Modal>
  );
};

export default OptimizePromptModal;
