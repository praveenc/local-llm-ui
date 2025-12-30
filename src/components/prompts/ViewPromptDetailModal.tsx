import ReactMarkdown from 'react-markdown';

import { Box, Button, CopyToClipboard, Modal, SpaceBetween } from '@cloudscape-design/components';

import type { SavedPrompt } from '../../db';

interface ViewPromptDetailModalProps {
  visible: boolean;
  onDismiss: () => void;
  prompt: SavedPrompt | null;
}

export function ViewPromptDetailModal({ visible, onDismiss, prompt }: ViewPromptDetailModalProps) {
  if (!prompt) return null;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={prompt.name}
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <CopyToClipboard
              copyButtonAriaLabel="Copy prompt"
              copyErrorText="Failed to copy"
              copySuccessText="Prompt copied"
              textToCopy={prompt.content}
              variant="normal"
            />
            <Button variant="primary" onClick={onDismiss}>
              Close
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box>
          <SpaceBetween direction="horizontal" size="xs">
            <Box variant="awsui-key-label">Category:</Box>
            <Box>{prompt.category}</Box>
          </SpaceBetween>
        </Box>
        <Box>
          <SpaceBetween direction="horizontal" size="xs">
            <Box variant="awsui-key-label">Created:</Box>
            <Box>{prompt.createdAt.toLocaleDateString()}</Box>
          </SpaceBetween>
        </Box>
        <Box variant="awsui-key-label">Prompt Content:</Box>
        <Box
          variant="code"
          padding="m"
          color="text-body-secondary"
          fontSize="body-s"
        >
          <div style={{ maxHeight: '400px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            <ReactMarkdown>{prompt.content}</ReactMarkdown>
          </div>
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
