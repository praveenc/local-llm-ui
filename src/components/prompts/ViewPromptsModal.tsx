import { useMemo, useState } from 'react';

import {
  Box,
  Button,
  CopyToClipboard,
  Input,
  Modal,
  Pagination,
  Select,
  SpaceBetween,
  Table,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import type { SavedPrompt } from '../../db';
import { useSavedPrompts } from '../../hooks';
import { promptsService } from '../../services';
import { ViewPromptDetailModal } from './ViewPromptDetailModal';

interface ViewPromptsModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const PAGE_SIZE = 10;

export function ViewPromptsModal({ visible, onDismiss }: ViewPromptsModalProps) {
  const { prompts, categories } = useSavedPrompts();
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SelectProps.Option | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPrompt, setSelectedPrompt] = useState<SavedPrompt | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filter prompts based on search and category
  const filteredPrompts = useMemo(() => {
    let result = prompts;

    if (searchText) {
      const lowerSearch = searchText.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.content.toLowerCase().includes(lowerSearch)
      );
    }

    if (selectedCategory && selectedCategory.value !== 'all') {
      result = result.filter((p) => p.category === selectedCategory.value);
    }

    return result;
  }, [prompts, searchText, selectedCategory]);

  // Paginate
  const paginatedPrompts = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredPrompts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredPrompts, currentPage]);

  const totalPages = Math.ceil(filteredPrompts.length / PAGE_SIZE);

  // Category options for filter
  const categoryOptions: SelectProps.Option[] = [
    { label: 'All Categories', value: 'all' },
    ...categories.map((cat) => ({ label: cat, value: cat })),
  ];

  const handleViewPrompt = (prompt: SavedPrompt) => {
    setSelectedPrompt(prompt);
    setShowDetailModal(true);
  };

  const handleDeletePrompt = async (id: string) => {
    await promptsService.deletePrompt(id);
  };

  const handleClose = () => {
    setSearchText('');
    setSelectedCategory(null);
    setCurrentPage(1);
    onDismiss();
  };

  return (
    <>
      <Modal
        visible={visible}
        onDismiss={handleClose}
        header="Saved Prompts"
        size="max"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={handleClose}>
              Close
            </Button>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {/* Search and Filter */}
          <SpaceBetween direction="horizontal" size="m">
            <div style={{ width: '300px' }}>
              <Input
                value={searchText}
                onChange={({ detail }) => {
                  setSearchText(detail.value);
                  setCurrentPage(1);
                }}
                placeholder="Search prompts..."
                type="search"
              />
            </div>
            <div style={{ width: '200px' }}>
              <Select
                selectedOption={selectedCategory}
                onChange={({ detail }) => {
                  setSelectedCategory(detail.selectedOption);
                  setCurrentPage(1);
                }}
                options={categoryOptions}
                placeholder="Filter by category"
              />
            </div>
          </SpaceBetween>

          {/* Prompts Table */}
          <Table
            items={paginatedPrompts}
            columnDefinitions={[
              {
                id: 'name',
                header: 'Prompt Name',
                cell: (item) => item.name,
                sortingField: 'name',
                width: 200,
              },
              {
                id: 'category',
                header: 'Category',
                cell: (item) => (
                  <Box
                    display="inline-block"
                    padding={{ horizontal: 'xs', vertical: 'xxs' }}
                    fontSize="body-s"
                    color="text-body-secondary"
                  >
                    {item.category}
                  </Box>
                ),
                width: 120,
              },
              {
                id: 'createdAt',
                header: 'Created On',
                cell: (item) => item.createdAt.toLocaleDateString(),
                sortingField: 'createdAt',
                width: 120,
              },
              {
                id: 'view',
                header: 'View',
                cell: (item) => (
                  <Button
                    variant="icon"
                    iconName="file-open"
                    ariaLabel="View prompt"
                    onClick={() => handleViewPrompt(item)}
                  />
                ),
                width: 60,
              },
              {
                id: 'copy',
                header: 'Copy',
                cell: (item) => (
                  <CopyToClipboard
                    copyButtonAriaLabel="Copy prompt"
                    copyErrorText="Failed to copy"
                    copySuccessText="Copied"
                    textToCopy={item.content}
                    variant="icon"
                  />
                ),
                width: 60,
              },
              {
                id: 'delete',
                header: 'Delete',
                cell: (item) => (
                  <Button
                    variant="icon"
                    iconName="remove"
                    ariaLabel="Delete prompt"
                    onClick={() => handleDeletePrompt(item.id)}
                  />
                ),
                width: 60,
              },
            ]}
            empty={
              <Box textAlign="center" color="inherit">
                <SpaceBetween size="m">
                  <b>No saved prompts</b>
                  <Box variant="p" color="inherit">
                    Save prompts from the chat input or message history to see them here.
                  </Box>
                </SpaceBetween>
              </Box>
            }
            header={
              <Box>
                <SpaceBetween direction="horizontal" size="xs">
                  <Box variant="awsui-key-label">Total prompts:</Box>
                  <Box>{filteredPrompts.length}</Box>
                </SpaceBetween>
              </Box>
            }
            pagination={
              totalPages > 1 && (
                <Pagination
                  currentPageIndex={currentPage}
                  pagesCount={totalPages}
                  onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
                />
              )
            }
          />
        </SpaceBetween>
      </Modal>

      <ViewPromptDetailModal
        visible={showDetailModal}
        onDismiss={() => setShowDetailModal(false)}
        prompt={selectedPrompt}
      />
    </>
  );
}
