import { describe, expect, it } from 'vitest';

import {
  formatCreditRate,
  formatCredits,
  kiroEffortSetting,
  kiroModelLabel,
  kiroSupportsThinking,
  kiroThinkingEfforts,
  parseKiroModels,
} from '../kiroModels';
import type { KiroModel } from '../kiroModels';

describe('kiroModelLabel', () => {
  it.each([
    ['claude-opus-5.5', 'Claude Opus 5.5'],
    ['claude-haiku-4.5', 'Claude Haiku 4.5'],
    ['gpt-5.6-sol', 'GPT 5.6 Sol'],
    ['grok-4.7', 'Grok 4.7'],
    ['kimi-k3', 'Kimi K3'],
    ['deepseek-3.2', 'DeepSeek 3.2'],
    ['minimax-m2.5', 'MiniMax M2.5'],
    ['glm-5', 'GLM 5'],
    ['qwen3-coder-next', 'Qwen3 Coder Next'],
    ['agi-nova-beta-1m', 'AGI Nova Beta 1M'],
    ['auto', 'Auto'],
  ])('%s → %s', (id, label) => {
    expect(kiroModelLabel(id)).toBe(label);
  });
});

const configOptions = [
  {
    id: 'mode',
    type: 'select',
    currentValue: 'vibe',
    options: [{ value: 'vibe', name: 'Default' }],
  },
  {
    id: 'model',
    type: 'select',
    currentValue: 'claude-sonnet-5.5',
    options: [
      {
        value: 'auto',
        name: 'auto',
        description: 'Models chosen by task',
        _meta: { kiro: { rateMultiplier: 1, rateUnit: 'Credit', thinkingToggleable: false } },
      },
      {
        value: 'claude-opus-5.5',
        name: 'claude-opus-5.5',
        description: 'Claude Opus 5.5 model with 1M context window',
        _meta: {
          kiro: {
            rateMultiplier: 2,
            hasEffort: true,
            effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
            defaultEffortLevel: 'medium',
            thinkingToggleable: false,
          },
        },
      },
      {
        value: 'gpt-5.6-luna',
        name: 'gpt-5.6-luna',
        _meta: {
          kiro: {
            rateMultiplier: 0.6,
            hasEffort: true,
            effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'turbo'],
            defaultEffortLevel: 'high',
          },
        },
      },
      {
        value: 'claude-haiku-5.5',
        name: 'claude-haiku-5.5',
        _meta: {
          kiro: {
            rateMultiplier: 0.06,
            hasEffort: true,
            effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
            defaultEffortLevel: 'medium',
            thinkingToggleable: true,
          },
        },
      },
      { value: 'bad id with spaces', name: 'x' },
      { value: 'claude-opus-5.5', name: 'duplicate' },
      { value: 42 },
    ],
  },
];

describe('parseKiroModels', () => {
  const models = parseKiroModels(configOptions);

  it('keeps Kiro order, drops bad and repeated ids', () => {
    expect(models.map((m) => m.id)).toEqual([
      'auto',
      'claude-opus-5.5',
      'gpt-5.6-luna',
      'claude-haiku-5.5',
    ]);
  });

  it('reads names, descriptions, rates, and levels', () => {
    expect(models[0]).toEqual({
      id: 'auto',
      name: 'Auto',
      description: 'Models chosen by task',
      rateMultiplier: 1,
    });
    expect(models[1]).toEqual({
      id: 'claude-opus-5.5',
      name: 'Claude Opus 5.5',
      description: 'Claude Opus 5.5 model with 1M context window',
      rateMultiplier: 2,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffortLevel: 'medium',
    });
  });

  it('keeps only known levels, in order', () => {
    expect(models[2].effortLevels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(models[3].thinkingToggleable).toBe(true);
  });

  it('returns [] without a model option', () => {
    expect(parseKiroModels([{ id: 'mode', options: [] }])).toEqual([]);
    expect(parseKiroModels(undefined)).toEqual([]);
    expect(parseKiroModels({})).toEqual([]);
  });
});

const opus: KiroModel = {
  id: 'claude-opus-5.5',
  name: 'Claude Opus 5.5',
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffortLevel: 'medium',
};
const gpt: KiroModel = {
  id: 'gpt-5.6-sol',
  name: 'GPT 5.6 Sol',
  effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffortLevel: 'high',
};
const sonnet46: KiroModel = {
  id: 'claude-sonnet-4.6',
  name: 'Claude Sonnet 4.6',
  effortLevels: ['low', 'medium', 'high', 'max'],
  defaultEffortLevel: 'high',
  thinkingToggleable: true,
};
const grok: KiroModel = {
  id: 'grok-4.7',
  name: 'Grok 4.7',
  effortLevels: ['low', 'medium', 'high', 'xhigh'],
  defaultEffortLevel: 'high',
};
const kimi: KiroModel = {
  id: 'kimi-k3',
  name: 'Kimi K3',
  effortLevels: ['low', 'high', 'max'],
  defaultEffortLevel: 'max',
};
const glm: KiroModel = { id: 'glm-5', name: 'GLM 5' };
const toggleOnly: KiroModel = { id: 'x', name: 'X', thinkingToggleable: true };

describe('kiroEffortSetting', () => {
  it('has no setting for a model without a Thinking choice', () => {
    expect(kiroEffortSetting('high', glm)).toBeUndefined();
    expect(kiroSupportsThinking(glm)).toBe(false);
  });

  it('uses the model default for Default', () => {
    expect(kiroEffortSetting('default', opus)).toEqual({ effortLevel: 'medium' });
    expect(kiroEffortSetting('default', sonnet46)).toEqual({ effortLevel: 'high', thinking: 'on' });
  });

  it('turns thinking off with none, the switch, or the lowest level', () => {
    expect(kiroEffortSetting('off', gpt)).toEqual({ effortLevel: 'none' });
    expect(kiroEffortSetting('off', sonnet46)).toEqual({ thinking: 'off' });
    expect(kiroEffortSetting('off', opus)).toEqual({ effortLevel: 'low' });
    expect(kiroEffortSetting('off', toggleOnly)).toEqual({ thinking: 'off' });
  });

  it('maps Minimal to the lowest level above none', () => {
    expect(kiroEffortSetting('minimal', gpt)).toEqual({ effortLevel: 'low' });
    expect(kiroEffortSetting('minimal', kimi)).toEqual({ effortLevel: 'low' });
  });

  it('sends the level, or the nearest one, the lower one on a tie', () => {
    expect(kiroEffortSetting('max', opus)).toEqual({ effortLevel: 'max' });
    expect(kiroEffortSetting('max', grok)).toEqual({ effortLevel: 'xhigh' });
    expect(kiroEffortSetting('xhigh', sonnet46)).toEqual({ effortLevel: 'high', thinking: 'on' });
    expect(kiroEffortSetting('medium', kimi)).toEqual({ effortLevel: 'low' });
  });

  it('turns thinking on for a switch-only model', () => {
    expect(kiroEffortSetting('high', toggleOnly)).toEqual({ thinking: 'on' });
  });
});

describe('kiroThinkingEfforts', () => {
  it('lists Default, Off, and the model levels', () => {
    expect(kiroThinkingEfforts(opus)).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(kiroThinkingEfforts(gpt)).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(kiroThinkingEfforts(grok)).toEqual(['default', 'off', 'low', 'medium', 'high', 'xhigh']);
    expect(kiroThinkingEfforts(toggleOnly)).toEqual(['default', 'off']);
    expect(kiroThinkingEfforts(glm)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats credit rates', () => {
    expect(formatCreditRate(2)).toBe('2× credits');
    expect(formatCreditRate(1.3)).toBe('1.3× credits');
    expect(formatCreditRate(0.06)).toBe('0.06× credits');
    expect(formatCreditRate(0.0549)).toBe('0.05× credits');
  });

  it('formats credits', () => {
    expect(formatCredits(0.051861810945273625)).toBe('0.05 credits');
    expect(formatCredits(0.631817124212272)).toBe('0.63 credits');
    expect(formatCredits(1)).toBe('1 credit');
    expect(formatCredits(12.5)).toBe('12.5 credits');
    expect(formatCredits(0.0057)).toBe('0.0057 credits');
    expect(formatCredits(0)).toBe('0 credits');
  });
});
