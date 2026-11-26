/**
 * The options that a Kiro chat request may set (SEC-20): the session options that Kiro lists
 * (the agent and options such as Autopilot) to values that Kiro lists, then the model, then the
 * Thinking level as `effortLevel` or `thinking`. Nothing else from the browser reaches
 * set_config_option. Kiro takes an unlisted value without an error and changes the session (K9
 * probe), so every value is checked against the session's current list before it is sent, and
 * read back after it (agent.setOption).
 */
import type { KiroChatRequest } from '../../src/utils/kiroChat.ts';
import { kiroEffortSetting, parseKiroModels } from '../../src/utils/kiroModels.ts';
import { compactSessionOption } from '../../src/utils/sessionOptions.ts';
import type { SessionOption, SessionOptionsSnapshot } from '../../src/utils/sessionOptions.ts';
import { listsValue, optionById } from '../acp/config-options.ts';
import { checkOptionChange, splitSessionOptions } from '../acp/session-options.ts';
import type { ConfigOption } from '../acp/types.ts';
import type { KiroAgent } from './agent.ts';
import { KiroOptionError } from './errors.ts';
import { KIRO_APP_OWNED_OPTION_IDS, KIRO_PROCESS_WIDE_OPTION_IDS } from './harness.ts';

export type KiroOptionsAgent = Pick<KiroAgent, 'configOptions' | 'setOption'>;

/** A compact option, marked `scope: 'process'` when Kiro keeps its value per process */
function compactKiroOption(raw: ConfigOption): SessionOption | undefined {
  const option = compactSessionOption(raw);
  if (!option || !KIRO_PROCESS_WIDE_OPTION_IDS.includes(option.id)) return option;
  return { ...option, scope: 'process' };
}

/** The session options of a Kiro session for the browser: the agent and the options without an app control */
export function kiroSessionOptions(configOptions: unknown): SessionOptionsSnapshot {
  const list = Array.isArray(configOptions) ? (configOptions as ConfigOption[]) : [];
  const { mode, rest } = splitSessionOptions(list, KIRO_APP_OWNED_OPTION_IDS);
  const compactMode = mode && compactKiroOption(mode);
  return {
    ...(compactMode && { mode: compactMode }),
    options: rest.map(compactKiroOption).filter((o): o is SessionOption => o !== undefined),
  };
}

const optionName = (option: ConfigOption) =>
  typeof option.name === 'string' && option.name ? option.name : 'an option';

/** The browser's text for a value that the option does not list. Never echoes the value. */
export const kiroOptionValueError = (option: ConfigOption) =>
  `Kiro does not offer this value for ${optionName(option)}. Pick another value.`;

/** The browser's text when Kiro did not take a listed value (read-back) */
export const kiroOptionNotTakenError = (option: ConfigOption) =>
  `Kiro did not change ${optionName(option)}. Try again.`;

/**
 * Sets the session options of the request: the agent first (it can change the option list),
 * then the others in Kiro's order, each checked against the current list. Returns an error text
 * for the browser, or undefined.
 */
async function applySessionOptions(
  agent: KiroOptionsAgent,
  id: string,
  request: KiroChatRequest
): Promise<string | undefined> {
  const wanted = new Map(Object.entries(request.sessionOptions ?? {}));
  if (wanted.size === 0) return undefined;
  let current = agent.configOptions(id) ?? [];
  // Before anything is sent: a value that the session does not list fails the reply
  for (const [configId, value] of wanted) {
    const check = checkOptionChange(current, KIRO_APP_OWNED_OPTION_IDS, configId, value);
    if (!check.ok && check.reason === 'value') return kiroOptionValueError(check.option);
  }
  let dropped = 0;
  const apply = async (configId: string): Promise<string | undefined> => {
    const value = wanted.get(configId)!;
    wanted.delete(configId);
    const check = checkOptionChange(current, KIRO_APP_OWNED_OPTION_IDS, configId, value);
    if (!check.ok) {
      if (check.reason === 'value') return kiroOptionValueError(check.option);
      dropped += 1;
      return undefined;
    }
    if (check.option.currentValue === value) return undefined;
    // Kiro keeps these values in the session. The app does not set them again after a load, so
    // a change that the user made in the terminal stays.
    try {
      current = await agent.setOption(id, configId, value, { remember: false });
    } catch (error) {
      // A failed read-back: Kiro's name of the option, not its id
      if (error instanceof KiroOptionError) return kiroOptionNotTakenError(check.option);
      throw error;
    }
    return undefined;
  };

  const modeId = splitSessionOptions(current, KIRO_APP_OWNED_OPTION_IDS).mode?.id;
  if (modeId && wanted.has(modeId)) {
    const error = await apply(modeId);
    if (error) return error;
  }
  for (const option of [...current]) {
    if (!wanted.has(option.id)) continue;
    const error = await apply(option.id);
    if (error) return error;
  }
  dropped += wanted.size;
  if (dropped > 0) {
    // The count only: never the ids or the values
    console.warn(
      `[kiro] dropped ${dropped} session options that the session does not list or that an app control sets`
    );
  }
  return undefined;
}

/**
 * Sets the session options, the model, and the Thinking level when they differ from the
 * session. Returns an error text for the browser, or undefined.
 */
export async function applyOptions(
  agent: KiroOptionsAgent,
  id: string,
  request: KiroChatRequest
): Promise<string | undefined> {
  const optionError = await applySessionOptions(agent, id, request);
  if (optionError) return optionError;

  let current = agent.configOptions(id) ?? [];
  const modelOption = optionById(current, 'model');
  if (!listsValue(modelOption, request.model)) {
    return `Kiro does not offer the model ${request.model} any more. Select a different model.`;
  }
  if (modelOption?.currentValue !== request.model) {
    // A model change resets Kiro's effort: read the options again
    current = await agent.setOption(id, 'model', request.model);
  }

  const meta = parseKiroModels(current).find((m) => m.id === request.model);
  const setting = meta && kiroEffortSetting(request.thinkingEffort ?? 'default', meta);
  if (!setting) return undefined;
  const wantedEffort: [string, string | undefined][] = [
    ['effortLevel', setting.effortLevel],
    ['thinking', setting.thinking],
  ];
  for (const [configId, value] of wantedEffort) {
    if (!value) continue;
    const option = optionById(current, configId);
    // kiro-cli 3.4 has no effortLevel: skip an option that the session does not have
    if (!listsValue(option, value) || option?.currentValue === value) continue;
    current = await agent.setOption(id, configId, value);
  }
  return undefined;
}
