// Runs in a child Node (`node --experimental-strip-types`): starts the Kiro agent with the fake,
// opens a session, prints "ready", and waits for a signal from the test.
import { KiroAgent } from '../../kiro/agent.ts';

const home = process.env.HOME ?? '';
const agent = new KiroAgent({
  environment: { env: { ...process.env }, home, platform: 'linux' },
  idleMs: 600_000,
});

await agent.newSession();
process.stdout.write('ready\n');
setInterval(() => undefined, 1_000_000);
