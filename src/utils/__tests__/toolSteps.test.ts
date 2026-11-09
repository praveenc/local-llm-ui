import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_STEPS,
  MAX_TOOL_STEPS,
  MIN_TOOL_STEPS,
  clampToolSteps,
  loadMaxToolSteps,
  saveMaxToolSteps,
} from '../toolSteps';

describe('clampToolSteps', () => {
  it('keeps a value in the range and rounds it', () => {
    expect(clampToolSteps(7)).toBe(7);
    expect(clampToolSteps(7.6)).toBe(8);
  });

  it('limits a value to the range', () => {
    expect(clampToolSteps(0)).toBe(MIN_TOOL_STEPS);
    expect(clampToolSteps(1000)).toBe(MAX_TOOL_STEPS);
  });

  it('uses the default for a value that is not a number', () => {
    expect(clampToolSteps(undefined)).toBe(DEFAULT_TOOL_STEPS);
    expect(clampToolSteps('12')).toBe(DEFAULT_TOOL_STEPS);
    expect(clampToolSteps(Number.NaN)).toBe(DEFAULT_TOOL_STEPS);
  });
});

describe('loadMaxToolSteps and saveMaxToolSteps', () => {
  beforeEach(() => localStorage.clear());

  it('uses the default when nothing is saved', () => {
    expect(loadMaxToolSteps()).toBe(DEFAULT_TOOL_STEPS);
  });

  it('saves and loads the value', () => {
    saveMaxToolSteps(15);
    expect(loadMaxToolSteps()).toBe(15);
  });

  it('ignores a malformed value', () => {
    localStorage.setItem('local-llm-ui-max-tool-steps', 'abc');
    expect(loadMaxToolSteps()).toBe(DEFAULT_TOOL_STEPS);
  });
});
