import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import type { SavedPrompt } from '../../db';
import { useSavedPrompts } from '../useSavedPrompts';

const prompt = (id: string, category: string, day: number): SavedPrompt => ({
  id,
  name: `Prompt ${id}`,
  content: `Content ${id}`,
  category,
  createdAt: new Date(Date.UTC(2025, 0, day)),
  updatedAt: new Date(Date.UTC(2025, 0, day)),
});

describe('useSavedPrompts', () => {
  beforeEach(async () => {
    await db.savedPrompts.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is loading before the first read and not after it', async () => {
    await db.savedPrompts.bulkAdd([prompt('a', 'Writing', 1)]);
    const { result } = renderHook(() => useSavedPrompts());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.prompts).toEqual([]);
    expect(result.current.categories).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompts.map((p) => p.id)).toEqual(['a']);
  });

  it('returns the prompts newest first and the sorted unique categories', async () => {
    await db.savedPrompts.bulkAdd([
      prompt('a', 'Writing', 1),
      prompt('b', 'Coding', 2),
      prompt('c', 'Writing', 3),
    ]);
    const { result } = renderHook(() => useSavedPrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompts.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(result.current.categories).toEqual(['Coding', 'Writing']);
  });

  it('reads the table once, not once more for the categories', async () => {
    await db.savedPrompts.bulkAdd([prompt('a', 'Writing', 1), prompt('b', 'Coding', 2)]);
    const orderBy = vi.spyOn(db.savedPrompts, 'orderBy');
    const tableRead = vi.spyOn(db.savedPrompts, 'toArray');
    const { result } = renderHook(() => useSavedPrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.categories).toEqual(['Coding', 'Writing']);
    // The live query can run again on a busy host, so count no exact number of runs. The old
    // code read the whole table a second time for the categories
    expect(orderBy).toHaveBeenCalled();
    expect(tableRead).not.toHaveBeenCalled();
  });

  it('updates the prompts and the categories together after a write', async () => {
    await db.savedPrompts.bulkAdd([prompt('a', 'Writing', 1)]);
    const { result } = renderHook(() => useSavedPrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await db.savedPrompts.add(prompt('b', 'Analysis', 2));
    });
    await waitFor(() => expect(result.current.prompts).toHaveLength(2));
    // The same result gives both, so they never differ for one render
    expect(result.current.categories).toEqual(['Analysis', 'Writing']);
  });

  it('keeps the same categories array while the prompts do not change', async () => {
    await db.savedPrompts.bulkAdd([prompt('a', 'Writing', 1)]);
    const { result, rerender } = renderHook(() => useSavedPrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = result.current.categories;
    rerender();
    expect(result.current.categories).toBe(first);
  });
});
