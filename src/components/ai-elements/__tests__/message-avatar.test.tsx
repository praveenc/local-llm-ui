import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageAvatar } from '../message';

describe('MessageAvatar', () => {
  it('renders the initials and hides them from assistive tech', () => {
    render(<MessageAvatar initials="PC" />);

    const avatar = screen.getByText('PC');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });
});
