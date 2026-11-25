import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface KiroSessionsChoiceProps {
  /** Kiro is signed in: the choice shows only then */
  signedIn: boolean;
  /** The stored choice; undefined until you answer the question */
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}

/**
 * In the Kiro row after sign-in (D11): first a question with Show and Not now, then a switch
 * that keeps the choice. The sidebar shows the Kiro sessions section only when it is on.
 */
export function KiroSessionsChoice({ signedIn, value, onChange }: KiroSessionsChoiceProps) {
  if (!signedIn) return null;

  if (value === undefined) {
    return (
      <div
        role="group"
        aria-labelledby="kiro-sessions-question"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-muted/40 py-2 pl-10 pr-3"
      >
        <p className="min-w-0 flex-1 text-xs">
          <span id="kiro-sessions-question">Show your Kiro sessions in the sidebar?</span>
          <span className="block text-muted-foreground">
            You can open a session from the terminal here and continue it.
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 pointer-coarse:h-11"
            onClick={() => onChange(false)}
          >
            Not now
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 pointer-coarse:h-11"
            onClick={() => onChange(true)}
          >
            Show
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-t bg-muted/40 py-2 pl-10 pr-3">
      <div className="min-w-0 flex-1 text-xs">
        <Label htmlFor="kiro-sessions-switch" className="text-xs font-normal">
          Show Kiro sessions in the sidebar
        </Label>
        <p id="kiro-sessions-switch-help" className="text-muted-foreground">
          The sessions come from Kiro. Delete in the app keeps Kiro&apos;s files.
        </p>
      </div>
      <Switch
        id="kiro-sessions-switch"
        aria-describedby="kiro-sessions-switch-help"
        checked={value}
        onCheckedChange={onChange}
      />
    </div>
  );
}
