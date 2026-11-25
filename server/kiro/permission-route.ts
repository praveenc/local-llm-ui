/**
 * POST /api/kiro/permission: the user's answer to one open Kiro question.
 *
 * The body is `{ requestId, optionId }` (JSON, at most 1 KB). The request id is the server's own
 * random id from the `permission` event, never Kiro's JSON-RPC id. The option must be one that the
 * question lists. 200 on the answer, 404 for an unknown or ended question, 400 otherwise. The route
 * never starts Kiro CLI. Logs the result only: no ids, no option.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import {
  KIRO_PERMISSION_BODY_LIMIT,
  parseKiroPermissionAnswer,
} from '../../src/utils/kiroPermissions.ts';
import type { PermissionRegistry } from '../acp/permission-registry.ts';
import { readBodyWithLimit } from '../security.ts';

export const QUESTION_ENDED = 'This question has ended';
export const OPTION_NOT_OFFERED = 'Kiro did not offer this option';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createKiroPermissionHandler(registry: Pick<PermissionRegistry, 'answer'>) {
  return async function handleKiroPermission(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readBodyWithLimit(req, res, KIRO_PERMISSION_BODY_LIMIT);
    if (body === null) return;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'The request body is not valid JSON' });
      return;
    }
    const parsed = parseKiroPermissionAnswer(json);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const result = registry.answer(parsed.value.requestId, parsed.value.optionId);
    console.log(`[kiro] permission answer: ${result}`);
    if (result === 'answered') sendJson(res, 200, { answered: true });
    else if (result === 'unknown') sendJson(res, 404, { error: QUESTION_ENDED });
    else sendJson(res, 400, { error: OPTION_NOT_OFFERED });
  };
}
