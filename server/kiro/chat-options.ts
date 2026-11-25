/**
 * The options that a Kiro chat request may set (SEC-16): the model, and the Thinking level as
 * `effortLevel` or `thinking`. Nothing else from the browser reaches set_config_option.
 */
import type { KiroChatRequest } from '../../src/utils/kiroChat.ts';
import { kiroEffortSetting, parseKiroModels } from '../../src/utils/kiroModels.ts';
import { listsValue, optionById } from '../acp/config-options.ts';
import type { KiroAgent } from './agent.ts';

export type KiroOptionsAgent = Pick<KiroAgent, 'configOptions' | 'setOption'>;

/**
 * Sets the model and the Thinking level when they differ from the session. Returns an error
 * text for the browser, or undefined.
 */
export async function applyOptions(
  agent: KiroOptionsAgent,
  id: string,
  request: KiroChatRequest
): Promise<string | undefined> {
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
  const wanted: [string, string | undefined][] = [
    ['effortLevel', setting.effortLevel],
    ['thinking', setting.thinking],
  ];
  for (const [configId, value] of wanted) {
    if (!value) continue;
    const option = optionById(current, configId);
    // kiro-cli 3.4 has no effortLevel: skip an option that the session does not have
    if (!listsValue(option, value) || option?.currentValue === value) continue;
    current = await agent.setOption(id, configId, value);
  }
  return undefined;
}
