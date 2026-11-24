import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModelSelector, ModelSelectorContent, ModelSelectorInput } from '../model-selector';

const open = (showCloseButton?: boolean) =>
  render(
    <ModelSelector open>
      <ModelSelectorContent showCloseButton={showCloseButton}>
        <ModelSelectorInput placeholder="Search" />
      </ModelSelectorContent>
    </ModelSelector>
  );

describe('ModelSelectorContent', () => {
  it('pads the search wrapper so text stays clear of the close button', () => {
    open();
    const cmd = document.querySelector('[data-slot="command"]')!;
    expect(cmd.className).toContain('command-input-wrapper]:pr-12');
  });

  it('adds no padding without a close button', () => {
    open(false);
    const cmd = document.querySelector('[data-slot="command"]')!;
    expect(cmd.className).not.toContain(':pr-12');
  });
});
