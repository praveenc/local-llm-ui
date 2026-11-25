/** The errors of the Kiro agent. `kiro/agent.ts` re-exports them. */

export class KiroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class KiroNotInstalledError extends KiroError {}
export class KiroSignedOutError extends KiroError {}
export class KiroSessionError extends KiroError {}
export class KiroOptionError extends KiroError {}
export class KiroBusyError extends KiroError {}
export class KiroCrashedError extends KiroError {}
export class KiroCancelTimeoutError extends KiroError {}
