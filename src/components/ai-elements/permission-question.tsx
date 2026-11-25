/**
 * Kiro's open question about a tool call (K6), under the tool's line in the work row: what Kiro
 * wants to do, and Kiro's options as buttons in Kiro's order. A click sends the option to the
 * server; the buttons stay off until Kiro's answer ends the question or the send fails.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { kiroService } from '../../services/kiro';
import { type ToolApproval, questionLine } from '../../utils/kiroPermissions';

interface PermissionQuestionProps {
  /** An open approval: it has Kiro's options */
  approval: ToolApproval;
}

export function PermissionQuestion({ approval }: PermissionQuestionProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const line = questionLine(approval);

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
      <p className="text-foreground">{line}</p>
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
