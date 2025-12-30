/**
 * Service for managing saved prompts in Dexie DB
 */
import { db } from '../db';
import type { CreateSavedPromptInput, SavedPrompt } from '../db';

class PromptsService {
  /**
   * Save a new prompt
   */
  async savePrompt(
    input: Omit<CreateSavedPromptInput, 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const now = new Date();
    const id = crypto.randomUUID();

    const prompt: SavedPrompt = {
      id,
      name: input.name,
      content: input.content,
      category: input.category || 'default',
      createdAt: now,
      updatedAt: now,
    };

    await db.savedPrompts.add(prompt);
    return id;
  }

  /**
   * Get all saved prompts
   */
  async getAllPrompts(): Promise<SavedPrompt[]> {
    return db.savedPrompts.orderBy('createdAt').reverse().toArray();
  }

  /**
   * Get prompts by category
   */
  async getPromptsByCategory(category: string): Promise<SavedPrompt[]> {
    return db.savedPrompts.where('category').equals(category).reverse().sortBy('createdAt');
  }

  /**
   * Search prompts by name (case-insensitive contains)
   */
  async searchPrompts(searchTerm: string, category?: string): Promise<SavedPrompt[]> {
    const lowerSearch = searchTerm.toLowerCase();

    let prompts = await db.savedPrompts.toArray();

    // Filter by search term
    if (searchTerm) {
      prompts = prompts.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.content.toLowerCase().includes(lowerSearch)
      );
    }

    // Filter by category if provided
    if (category && category !== 'all') {
      prompts = prompts.filter((p) => p.category === category);
    }

    // Sort by createdAt descending
    return prompts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get a single prompt by ID
   */
  async getPromptById(id: string): Promise<SavedPrompt | undefined> {
    return db.savedPrompts.get(id);
  }

  /**
   * Update a prompt
   */
  async updatePrompt(
    id: string,
    updates: Partial<Pick<SavedPrompt, 'name' | 'content' | 'category'>>
  ): Promise<void> {
    await db.savedPrompts.update(id, {
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(id: string): Promise<void> {
    await db.savedPrompts.delete(id);
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const prompts = await db.savedPrompts.toArray();
    const categories = new Set(prompts.map((p) => p.category));
    return Array.from(categories).sort();
  }
}

export const promptsService = new PromptsService();
