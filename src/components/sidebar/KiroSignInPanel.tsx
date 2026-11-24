/**
 * The panel under the Kiro row: the sign-in form, the code to compare while the person approves
 * the sign-in in the browser, the error, and the confirmation for signing out.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { KiroSignIn } from '../../hooks/useKiroSignIn';
import { validateRegion, validateStartUrl } from '../../utils/kiroLogin';
import type { KiroLoginMethod } from '../../utils/kiroLogin';
import type { KiroSignInPreference } from '../../utils/preferences';

/** Same look as the API key panel */
const PANEL_CLASS = 'space-y-3 border-t bg-muted/40 py-3 pl-10 pr-3';
export const KIRO_PANEL_ID = 'provider-kiro-panel';

export type KiroPanelMode = 'closed' | 'form' | 'sign-out';

interface KiroSignInPanelProps {
  /** True for a signed-in account, false for a signed-out one */
  signedIn: boolean;
  signIn: KiroSignIn;
  mode: KiroPanelMode;
  onModeChange: (mode: KiroPanelMode) => void;
  /** The method that was used last, to prefill the form */
  saved?: KiroSignInPreference;
  /** Kiro is the default provider, so the person must pick another one after signing out */
  isDefault: boolean;
  /** Saves the method when a sign-in starts */
  onRemember: (preference: KiroSignInPreference) => void;
  /** The sign-in will not make Kiro the default provider any more */
  onDismiss: () => void;
}

export function KiroSignInPanel(props: KiroSignInPanelProps) {
  const { signedIn, signIn, mode, onModeChange, onDismiss } = props;

  if (signedIn) {
    return mode === 'sign-out' ? (
      <SignOutConfirm
        isDefault={props.isDefault}
        signIn={signIn}
        onCancel={() => onModeChange('closed')}
        onDone={() => onModeChange('closed')}
      />
    ) : null;
  }

  if (signIn.phase === 'starting') {
    return (
      <div id={KIRO_PANEL_ID} aria-live="polite" className={PANEL_CLASS}>
        <p className="text-xs text-muted-foreground">Starting the sign-in…</p>
        <Button type="button" variant="ghost" size="sm" onClick={cancelAll(props)}>
          Cancel
        </Button>
      </div>
    );
  }

  if (signIn.phase === 'waiting') {
    return (
      <div id={KIRO_PANEL_ID} aria-live="polite" className={PANEL_CLASS}>
        <p className="text-xs text-muted-foreground">
          Approve the sign-in in the new browser tab. Check that it shows this code:
        </p>
        <p className="font-mono text-base font-semibold tracking-wider">{signIn.code}</p>
        <div className="flex items-center gap-3">
          <a
            href={signIn.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open sign-in page
          </a>
          <Button type="button" variant="ghost" size="sm" onClick={cancelAll(props)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (signIn.phase === 'error') {
    return (
      <div id={KIRO_PANEL_ID} aria-live="polite" className={PANEL_CLASS}>
        <p role="alert" className="break-words text-xs text-destructive">
          {signIn.message}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              signIn.reset();
              onModeChange('form');
            }}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              signIn.reset();
              onModeChange('closed');
              onDismiss();
            }}
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  return mode === 'form' ? <SignInForm {...props} /> : null;
}

function cancelAll({ signIn, onModeChange, onDismiss }: KiroSignInPanelProps) {
  return () => {
    signIn.cancel();
    onModeChange('closed');
    onDismiss();
  };
}

const METHOD_LABELS = {
  'builder-id': 'AWS Builder ID',
  'identity-center': 'IAM Identity Center',
} as const;

function SignInForm({ signIn, saved, onModeChange, onRemember, onDismiss }: KiroSignInPanelProps) {
  const [method, setMethod] = useState<KiroLoginMethod['method']>(saved?.method ?? 'builder-id');
  const [startUrl, setStartUrl] = useState(saved?.startUrl ?? '');
  const [region, setRegion] = useState(saved?.region ?? '');
  const [submitted, setSubmitted] = useState(false);

  const isCenter = method === 'identity-center';
  const startUrlError = isCenter && submitted ? validateStartUrl(startUrl) : undefined;
  const regionError = isCenter && submitted ? validateRegion(region) : undefined;

  const submit = () => {
    setSubmitted(true);
    if (isCenter && (validateStartUrl(startUrl) || validateRegion(region))) return;
    const login: KiroLoginMethod = isCenter
      ? { method, startUrl: startUrl.trim(), region: region.trim() }
      : { method: 'builder-id' };
    // The Identity Center values stay for the next time, also after a Builder ID sign-in
    onRemember({
      method,
      startUrl: isCenter ? startUrl.trim() : saved?.startUrl,
      region: isCenter ? region.trim() : saved?.region,
    });
    onModeChange('closed');
    signIn.start(login);
  };

  return (
    <form
      id={KIRO_PANEL_ID}
      className={PANEL_CLASS}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="kiro-sign-in-method">Sign-in method</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as KiroLoginMethod['method'])}>
          <SelectTrigger id="kiro-sign-in-method" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(METHOD_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCenter && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="kiro-start-url">Start URL</Label>
            <Input
              id="kiro-start-url"
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="https://my-company.awsapps.com/start"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!startUrlError}
              aria-describedby={startUrlError ? 'kiro-start-url-error' : undefined}
            />
            {startUrlError && (
              <p id="kiro-start-url-error" className="text-xs text-destructive">
                {startUrlError}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kiro-region">Region</Label>
            <Input
              id="kiro-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="us-east-1"
              autoComplete="off"
              spellCheck={false}
              className="sm:w-64"
              aria-invalid={!!regionError}
              aria-describedby={regionError ? 'kiro-region-error' : undefined}
            />
            {regionError && (
              <p id="kiro-region-error" className="text-xs text-destructive">
                {regionError}
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onModeChange('closed');
            onDismiss();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SignOutConfirm({
  isDefault,
  signIn,
  onCancel,
  onDone,
}: {
  isDefault: boolean;
  signIn: KiroSignIn;
  onCancel: () => void;
  onDone: () => void;
}) {
  return (
    <div id={KIRO_PANEL_ID} aria-live="polite" className={PANEL_CLASS}>
      <p className="text-xs text-muted-foreground">
        Sign out of Kiro? This also signs out Kiro CLI in your terminals and in other apps on this
        computer.
        {isDefault && ' Choose a different default provider after you sign out.'}
      </p>
      {signIn.signOutError && (
        <p role="alert" className="break-words text-xs text-destructive">
          {signIn.signOutError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={signIn.isSigningOut}
          onClick={() =>
            void signIn.signOut().then((ok) => {
              if (ok) onDone();
            })
          }
        >
          {signIn.isSigningOut ? 'Signing out…' : 'Sign out'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
