/**
 * The shared Kiro process (D5): one `kiro-cli acp` for all Kiro chats.
 *
 * The generic ACP agent (`../acp/agent.ts`) with the Kiro harness (`harness.ts`): it starts on
 * the first use and stops after 10 idle minutes. One process holds many sessions. After a crash,
 * a stop, or an idle stop, a session is not live: `ensureSession` opens it again with
 * `session/load`. Sessions keep Kiro's own defaults (Autopilot as in the terminal); Kiro asks
 * its permission questions in the chat (`approvals.ts`, D16, D17).
 *
 * Logs lifecycle lines only. Never log prompt text, tool input, or the account.
 */
import { AcpAgent } from '../acp/agent.ts';
import type { AcpAgentOptions, AgentState, AgentTimeouts } from '../acp/agent.ts';
import { createKiroHarness } from './harness.ts';
import type { KiroHarnessOptions, KiroSessionInfo } from './harness.ts';

export { AcpError, AcpTimeoutError } from '../acp/client.ts';
export { denyPermission, optionIdForKind } from '../acp/permissions.ts';
export type {
  PermissionDecision,
  PermissionEnd,
  PermissionHandler,
  PermissionQuestion,
  PromptPermissionHandler,
} from '../acp/permissions.ts';
export {
  KiroBusyError,
  KiroCancelTimeoutError,
  KiroCrashedError,
  KiroError,
  KiroNotInstalledError,
  KiroOptionError,
  KiroSessionError,
  KiroSignedOutError,
} from './errors.ts';
export { KIRO_EXTENSION_METHODS } from './harness.ts';
export type { KiroSessionInfo } from './harness.ts';

export type KiroAgentTimeouts = AgentTimeouts;
export type KiroAgentState = AgentState;

export interface KiroAgentOptions extends AcpAgentOptions, KiroHarnessOptions {}

export class KiroAgent extends AcpAgent<KiroSessionInfo> {
  constructor(options: KiroAgentOptions = {}) {
    super(createKiroHarness(options), options);
  }
}

let instance: KiroAgent | undefined;

/** The one Kiro agent of the app */
export function getKiroAgent(): KiroAgent {
  instance ??= new KiroAgent();
  return instance;
}

/**
 * For the server close: stops the Kiro agent for good. A caller that still holds it gets
 * "Kiro is stopping". The next getKiroAgent() makes a new agent, because Vite can start a new
 * server in the same process (for example after a change to vite.config.ts).
 */
export async function shutdownKiroAgent(): Promise<void> {
  const current = instance;
  if (!current) return;
  instance = undefined;
  await current.close();
}
