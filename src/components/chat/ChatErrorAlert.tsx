import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';

import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface ChatErrorAlertProps {
  error: string;
  className?: string;
}

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractMessage(value: unknown): string | null {
  const seen = new Set<unknown>();

  const walk = (v: unknown): string | null => {
    if (v == null) return null;

    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (!trimmed) return null;
      const parsed = parseJsonSafely(trimmed);
      if (parsed) return walk(parsed);
      return trimmed;
    }

    if (typeof v === 'object') {
      if (seen.has(v)) return null;
      seen.add(v);

      const obj = v as Record<string, unknown>;
      return (
        walk(obj.error) ||
        walk(obj.message) ||
        walk(obj.responseBody) ||
        walk(obj.cause) ||
        walk(obj.details) ||
        walk(obj.detail) ||
        walk(obj.data)
      );
    }

    return null;
  };

  return walk(value);
}

function getFriendlyHint(message: string): string | null {
  const msg = message.toLowerCase();

  if (msg.includes('tool calling') && msg.includes('not supported')) {
    return 'This model does not support tool calls. Disable MCP/Web Search or choose a model that supports tools.';
  }

  if (msg.includes('does not exist') || msg.includes('do not have access')) {
    return 'You may not have access to this model. Pick another model from the selector or verify your provider account access.';
  }

  if (msg.includes('api key')) {
    return 'Verify your API key in Preferences and try again.';
  }

  return null;
}

export function ChatErrorAlert({ error, className }: ChatErrorAlertProps) {
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const parsedError = useMemo(() => parseJsonSafely(error), [error]);
  const message = useMemo(
    () => extractMessage(parsedError ?? error) || error || 'Something went wrong.',
    [parsedError, error]
  );
  const hint = useMemo(() => getFriendlyHint(message), [message]);
  const rawDetails = useMemo(() => {
    if (parsedError) {
      return JSON.stringify(parsedError, null, 2);
    }
    return error;
  }, [parsedError, error]);

  const showDetails = rawDetails.trim() !== message.trim();

  const handleCopy = async () => {
    const text = `${message}${hint ? `\n\nHint: ${hint}` : ''}${
      showDetails ? `\n\nDetails:\n${rawDetails}` : ''
    }`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Alert variant="destructive" className={cn('mb-4', className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <AlertTitle className="text-sm font-semibold">Request failed</AlertTitle>
          <AlertDescription className="text-sm break-words">{message}</AlertDescription>

          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

          <div className="flex items-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy error'}
            </Button>

            {showDetails && (
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2">
                    <span>Details</span>
                    {detailsOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/60 bg-background/60 p-2 text-xs leading-relaxed whitespace-pre-wrap break-words">
                    {rawDetails}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </div>
    </Alert>
  );
}
