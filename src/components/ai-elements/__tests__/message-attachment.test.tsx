import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageAttachment } from '../message';

describe('MessageAttachment', () => {
  it('shows the name, the type, and the size of a file in text, not only in a tooltip', () => {
    render(
      <MessageAttachment
        data={{ type: 'file', mediaType: 'application/pdf', url: 'data:x', filename: 'notes.pdf' }}
        size={1536 * 1024}
      />
    );
    expect(screen.getByText('notes.pdf')).toBeVisible();
    expect(screen.getByText('PDF · 1.5 MB')).toBeVisible();
  });

  it('shows "File not kept" instead of the type and the size', () => {
    render(
      <MessageAttachment
        data={{ type: 'file', mediaType: 'image/png', url: '', filename: 'gone.png' }}
        size={100}
        notKept
      />
    );
    expect(screen.getByText('gone.png')).toBeVisible();
    expect(screen.getByText('File not kept')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('makes an image a button that opens it when onOpen is set', () => {
    const onOpen = vi.fn();
    render(
      <MessageAttachment
        data={{
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AA==',
          filename: 'a.png',
        }}
        onOpen={onOpen}
      />
    );
    screen.getByRole('button', { name: 'Open a.png' }).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'a.png' })).toBeInTheDocument();
    // The whole image shows, also a wide one, and the focus ring is not cut off by the frame
    expect(screen.getByRole('img', { name: 'a.png' })).toHaveClass('object-contain');
    expect(screen.getByRole('button', { name: 'Open a.png' })).toHaveClass(
      'focus-visible:ring-inset'
    );
  });
});
