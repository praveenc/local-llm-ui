import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SecretInput } from '../SecretInput';

describe('SecretInput', () => {
  it('toggles between password and text and keeps its label', () => {
    render(
      <>
        <label htmlFor="k">Groq API key</label>
        <SecretInput id="k" />
      </>
    );
    const input = screen.getByLabelText('Groq API key');
    const toggle = screen.getByRole('button', { name: 'Show API key' });
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
