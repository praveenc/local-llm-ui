import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StreamStatusAnnouncer } from '../StreamStatusAnnouncer';

describe('StreamStatusAnnouncer', () => {
  it('is empty before any reply', () => {
    render(<StreamStatusAnnouncer isLoading={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces the start and the end of a reply', () => {
    const { rerender } = render(<StreamStatusAnnouncer isLoading={false} />);
    rerender(<StreamStatusAnnouncer isLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Generating response');
    rerender(<StreamStatusAnnouncer isLoading={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Response complete');
  });

  it('says nothing at the end when the reply failed', () => {
    const { rerender } = render(<StreamStatusAnnouncer isLoading={false} />);
    rerender(<StreamStatusAnnouncer isLoading />);
    rerender(<StreamStatusAnnouncer isLoading={false} hasError />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
