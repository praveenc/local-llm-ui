/**
 * The folder for new Kiro chats (D6, SEC-21), in the Kiro row after sign-in.
 *
 * The folder is a server setting: the server checks it, stores its real path, and the chat request
 * never names a folder (SEC-16). This row saves like the rest of Preferences: a typed value saves
 * 700 ms after typing stops, when the field loses focus, and on Enter. It shows "Saved" or "Not
 * saved" with the reason in words, and it never keeps a value that the server refused.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useKiroStatus } from '../../hooks/useKiroStatus';
import { kiroService } from '../../services/kiro';
import { checkKiroFolderText } from '../../utils/kiroSettings';

const SAVE_DELAY_MS = 700;
const SAVED_LABEL_MS = 2000;

type Outcome = { kind: 'saved' } | { kind: 'error'; message: string };

interface KiroFolderSettingProps {
  /** Called when a save ends with "Saved" in the row (the Preferences footer says it too) */
  onSaved?: () => void;
}

export function KiroFolderSetting({ onSaved }: KiroFolderSettingProps = {}) {
  const { status, setFolder } = useKiroStatus();
  const folder = status?.folder;
  const fieldId = useId();
  const helpId = `${fieldId}-help`;
  const outcomeId = `${fieldId}-outcome`;

  // The text that the person typed and no save has taken yet; null shows the stored folder
  const [draft, setDraft] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const draftRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Only the newest request may change what the row shows
  const requestId = useRef(0);
  // The latest callback: a save can end after Preferences closed, so it must not be stale
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  const storedPath = useRef(folder?.path);
  useEffect(() => {
    storedPath.current = folder?.path;
  }, [folder?.path]);

  const changeDraft = useCallback((next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const cancelTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };

  const send = useCallback(
    async (value: string | null) => {
      const id = ++requestId.current;
      try {
        const saved = await kiroService.setWorkspaceDir(value);
        setFolder(saved);
        // The text that was sent is stored now. Text that the person typed since stays.
        if (value !== null && draftRef.current?.trim() === value) changeDraft(null);
        if (id !== requestId.current) return;
        setOutcome({ kind: 'saved' });
        onSavedRef.current?.();
      } catch (error) {
        if (id !== requestId.current) return;
        const message = error instanceof Error && error.message ? error.message : 'Try again.';
        setOutcome({ kind: 'error', message });
      }
    },
    [setFolder, changeDraft]
  );

  /** Saves the typed text now: the cheap checks first, and nothing when it did not change */
  const flush = useCallback(() => {
    cancelTimer();
    const text = draftRef.current;
    if (text === null) return;
    const value = text.trim();
    if (value === storedPath.current) {
      changeDraft(null);
      setOutcome(null);
      return;
    }
    const problem = checkKiroFolderText(value);
    if (problem) {
      requestId.current++;
      setOutcome({ kind: 'error', message: problem });
      return;
    }
    void send(value);
  }, [send, changeDraft]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  // A value that waits for its delay saves when Preferences closes
  useEffect(
    () => () => {
      if (timer.current !== undefined) flushRef.current();
      clearTimeout(timer.current);
    },
    []
  );

  // "Saved" shows for a moment, then the row is quiet again
  useEffect(() => {
    if (outcome?.kind !== 'saved') return;
    const hide = setTimeout(() => setOutcome(null), SAVED_LABEL_MS);
    return () => clearTimeout(hide);
  }, [outcome]);

  const onType = (text: string) => {
    changeDraft(text);
    // A request that runs now no longer decides what the row says
    requestId.current++;
    setOutcome(null);
    cancelTimer();
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const useDefault = () => {
    cancelTimer();
    changeDraft(null);
    setOutcome(null);
    void send(null);
  };

  const failed = outcome?.kind === 'error';
  const describedBy = outcome ? `${helpId} ${outcomeId}` : helpId;

  return (
    <div className="space-y-2 border-t bg-muted/40 py-2 pl-10 pr-3">
      <Label htmlFor={fieldId} className="text-xs font-normal">
        Folder for new Kiro chats
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={fieldId}
          value={draft ?? folder?.path ?? ''}
          onChange={(e) => onType(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') flush();
          }}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={failed || undefined}
          aria-describedby={describedBy}
          className="h-9 min-w-0 flex-1 basis-56 font-mono text-xs pointer-coarse:h-11"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 pointer-coarse:h-11"
          disabled={folder?.isDefault === true && draft === null}
          onClick={useDefault}
        >
          Use the default
        </Button>
      </div>
      <p id={helpId} className="text-xs text-muted-foreground">
        Kiro&apos;s tools read files and run commands in this folder. Kiro asks before it runs a
        command or writes a file.
      </p>
      {outcome?.kind === 'saved' && (
        <p id={outcomeId} role="status" className="text-xs text-muted-foreground">
          Saved
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p id={outcomeId} role="alert" className="text-xs text-destructive">
          Not saved. {outcome.message}
        </p>
      )}
    </div>
  );
}
