import { AlertTriangle, Eye, Search, Trash2 } from 'lucide-react';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import type { SavedPrompt } from '../../db';
import { useSavedPrompts } from '../../hooks';
import { promptsService } from '../../services';
import { CopyToClipboard } from '../shared';
import { ViewPromptDetailModal } from './ViewPromptDetailModal';

interface ViewPromptsModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const PAGE_SIZE = 10;

export function ViewPromptsModal({ visible, onDismiss }: ViewPromptsModalProps) {
  const { prompts, categories } = useSavedPrompts();
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPrompt, setSelectedPrompt] = useState<SavedPrompt | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<SavedPrompt | null>(null);

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

    if (selectedCategory && selectedCategory !== 'all') {
      result = result.filter((p) => p.category === selectedCategory);
    }

    return result;
  }, [prompts, searchText, selectedCategory]);

  // Paginate
  const paginatedPrompts = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredPrompts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredPrompts, currentPage]);

  const totalPages = Math.ceil(filteredPrompts.length / PAGE_SIZE);

  const handleViewPrompt = (prompt: SavedPrompt) => {
    setSelectedPrompt(prompt);
    setShowDetailModal(true);
  };

  const handleDeleteClick = (prompt: SavedPrompt) => {
    setPromptToDelete(prompt);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!promptToDelete) return;
    try {
      await promptsService.deletePrompt(promptToDelete.id);
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    } finally {
      setShowDeleteConfirm(false);
      setPromptToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setPromptToDelete(null);
  };

  const handleClose = () => {
    setSearchText('');
    setSelectedCategory('all');
    setCurrentPage(1);
    onDismiss();
  };

  return (
    <TooltipProvider>
      <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Saved Prompts</DialogTitle>
            <DialogDescription>Total prompts: {filteredPrompts.length}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 overflow-hidden">
            {/* Search and Filter */}
            <div className="flex gap-3">
              <div className="relative flex-1 max-w-[300px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search prompts..."
                  className="pl-9"
                />
              </div>
              <Select
                value={selectedCategory}
                onValueChange={(value) => {
                  setSelectedCategory(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompts Table */}
            <div className="flex-1 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Prompt Name</TableHead>
                    <TableHead className="w-[120px]">Category</TableHead>
                    <TableHead className="w-[120px]">Created On</TableHead>
                    <TableHead className="w-[120px] text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedPrompts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <p className="font-medium">No saved prompts</p>
                          <p className="text-sm text-muted-foreground">
                            Save prompts from the chat input or message history to see them here.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedPrompts.map((prompt) => (
                      <TableRow key={prompt.id}>
                        <TableCell className="font-medium">{prompt.name}</TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{prompt.category}</span>
                        </TableCell>
                        <TableCell>{new Date(prompt.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleViewPrompt(prompt)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View prompt</TooltipContent>
                            </Tooltip>
                            <CopyToClipboard
                              text={prompt.content}
                              size="icon"
                              className="h-8 w-8"
                            />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteClick(prompt)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete prompt</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={
                        currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                      }
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => setCurrentPage(page)}
                        isActive={currentPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={
                        currentPage === totalPages
                          ? 'pointer-events-none opacity-50'
                          : 'cursor-pointer'
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ViewPromptDetailModal
        visible={showDetailModal}
        onDismiss={() => setShowDetailModal(false)}
        prompt={selectedPrompt}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => !open && handleCancelDelete()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete prompt</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the prompt <strong>"{promptToDelete?.name}"</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <span>This action cannot be undone.</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancelDelete}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
