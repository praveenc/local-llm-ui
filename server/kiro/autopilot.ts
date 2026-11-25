/**
 * The Autopilot lock (D7, SEC-15): every Kiro session has Autopilot off, read back from Kiro,
 * and the app never changes `autopilot` or `mode` (D9). K6 deletes this file.
 *
 * When Autopilot stays on after a session opens, a session that this call created is deleted.
 * A loaded session is never deleted: it stays on disk and is not live.
 */
import type { SessionGuard } from '../acp/harness.ts';
import type { ConfigOption } from '../acp/types.ts';
import { KiroCrashedError, KiroSessionError } from './errors.ts';

/** Options that the app never changes: Autopilot stays off (D7), the agent stays Kiro's default (D9) */
const LOCKED_OPTIONS = new Set(['autopilot', 'mode']);

const autopilotOf = (options: ConfigOption[]) =>
  options.find((o) => o.id === 'autopilot')?.currentValue;

const refused = () => new KiroSessionError('Kiro did not turn off Autopilot');

export const kiroAutopilotGuard: SessionGuard = {
  isLocked: (configId) => LOCKED_OPTIONS.has(configId),

  async afterOpen(ctx, created) {
    if (autopilotOf(ctx.configOptions()) === 'off') return;
    let ok = false;
    try {
      ok = autopilotOf(await ctx.setConfig('autopilot', 'off')) === 'off';
    } catch (error) {
      if (error instanceof KiroCrashedError) throw error;
    }
    if (ok) return;
    ctx.drop();
    if (created) {
      try {
        await ctx.deleteSession();
      } catch {
        // The session stays on disk; it is not live in the app
      }
    }
    throw refused();
  },

  /**
   * When Autopilot is not off: cancel the session's reply, turn Autopilot off again, and keep the
   * session not live until Kiro reads back off. When that fails, the session is dropped (a later
   * ensureSession loads it).
   */
  check(ctx, options) {
    if (!options.length || autopilotOf(options) === 'off') return undefined;
    console.warn('[kiro] Autopilot turned on in a session, turning it off again');
    ctx.cancelReply();
    return (async () => {
      let ok = false;
      try {
        ok = autopilotOf(await ctx.setConfig('autopilot', 'off')) === 'off';
      } catch {
        // Not off: the session is dropped below
      }
      if (!ctx.isCurrent()) return;
      if (!ok) ctx.drop();
    })();
  },

  refused,
};
