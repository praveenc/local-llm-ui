/**
 * Kiro's open question about a tool call (K6), under the tool's line in the work row: what Kiro
 * wants to do, and Kiro's options as buttons in Kiro's order. A click sends the option to the
 * server; the buttons stay off until Kiro's answer ends the question or the send fails.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { kiroService } from '../../services/kiro';
import { type ToolApproval, questionLine, questionParts } from '../../utils/kiroPermissions';

interface PermissionQuestionProps {
  /** An open approval: it has Kiro's options */
  approval: ToolApproval;
}

export function PermissionQuestion({ approval }: PermissionQuestionProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const line = questionLine(approval);
  const { before, code, codeCut } = questionParts(approval);

  const answer = async (optionId: string) => {
    setState('sending');
    setError(null);
    try {
      await kiroService.answerPermission({ requestId: approval.requestId, optionId });
      // Stays off: the question ends when its result comes in the reply's stream
      setState('sent');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Try again');
      setState('idle');
    }
  };

  return (
    <div className="space-y-1.5 pb-2 pl-6 pr-1 pt-1" role="group" aria-label={line}>
      <p className="break-words text-foreground">{before}</p>
      {code && (
        // The whole command, with its line breaks. It wraps, and scrolls after about 10 lines.
        // It inherits the row's text size: this is the text that the user allows. It takes focus,
        // so that a keyboard user can scroll a long command before they answer.
        <pre
          tabIndex={0}
          aria-label="Command"
          className="max-h-[15em] max-w-full overflow-y-auto whitespace-pre-wrap rounded bg-surface-quiet px-2 py-1 font-mono leading-normal text-foreground [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <code>{code}</code>
        </pre>
      )}
      {code && codeCut && (
        <p className="text-muted-foreground">
          The command is longer than 2,000 characters. Only the start shows.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(approval.options ?? []).map((option) => (
          <Button
            key={option.optionId}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-11 px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            disabled={state !== 'idle'}
            onClick={() => void answer(option.optionId)}
          >
            {option.name}
          </Button>
        ))}
      </div>
      {state === 'sending' && <p className="text-muted-foreground">Sending your answer…</p>}
      {state === 'sent' && <p className="text-muted-foreground">Answer sent. Waiting for Kiro…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          Your answer was not sent: {error}
        </p>
      )}
    </div>
  );
}
