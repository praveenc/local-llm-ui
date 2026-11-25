import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useKiroSignIn } from '../../hooks/useKiroSignIn';
import { useKiroStatus } from '../../hooks/useKiroStatus';
import { useResolvedVisualMode } from '../../hooks/useResolvedVisualMode';
import { kiroDefaultProviderError } from '../../utils/kiroStatus';
import type { KiroStatus } from '../../utils/kiroStatus';
import {
  PROVIDER_API_KEY_FIELDS,
  isProviderConfigured,
  loadPreferences,
  savePreferences,
  validateInitials,
} from '../../utils/preferences';
import type { ContentDensity, UserPreferences, VisualMode } from '../../utils/preferences';
import { WEB_SEARCH_KEY_FIELDS } from '../../utils/webSearch';
import { ColorThemePicker } from './ColorThemePicker';
import { MCPServerSettings } from './MCPServerSettings';
import { ProviderSettings } from './ProviderSettings';
import { WebSearchSettings } from './WebSearchSettings';
import { providerLabel } from './providerOptions';

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after each save, with the preferences that were stored */
  onChange: (preferences: UserPreferences) => void;
  /** Tab to show each time the dialog opens; unset keeps the last tab */
  initialTab?: PreferencesTab;
}

export type PreferencesTab = 'providers' | 'web-search' | 'mcp' | 'display';

/**
 * Settings that change while you type (API keys, avatar initials, MCP server fields). They
 * save when you stop typing for SAVE_DELAY_MS, when focus leaves the field, on Enter, and when
 * the dialog closes. Every other setting saves at once.
 */
const TYPED_KEYS = new Set<keyof UserPreferences>([
  ...Object.values(PROVIDER_API_KEY_FIELDS),
  ...Object.values(WEB_SEARCH_KEY_FIELDS),
  'avatarInitials',
  'mcpServers',
]);
const SAVE_DELAY_MS = 700;
const SAVED_LABEL_MS = 2000;

type SaveStatus = 'idle' | 'saved' | 'not-saved';

export function PreferencesDialog({
  open,
  onOpenChange,
  onChange,
  initialTab,
}: PreferencesDialogProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [tab, setTab] = useState<PreferencesTab>('providers');
  const [wasOpen, setWasOpen] = useState(open);

  const [providerError, setProviderError] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const {
    status: kiroStatus,
    refresh: refreshKiro,
    isRefreshing: isRefreshingKiro,
  } = useKiroStatus();
  // Set when you pick Kiro while signed out: it becomes the default when the sign-in that the app
  // started works. A sign-in in a terminal (then Check again) never changes the default.
  const makeKiroDefault = useRef(false);
  const applyKiroDefault = useRef<(status: KiroStatus) => void>(() => {});
  // Here, not in the Providers tab: a sign-in goes on when you switch tabs or close the dialog
  const kiroSignIn = useKiroSignIn({
    onSignedIn: (signedIn) => applyKiroDefault.current(signedIn),
    onError: () => {
      makeKiroDefault.current = false;
    },
  });

  // Reload on open: other controls (the header theme toggle) also save preferences
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPreferences(loadPreferences());
      setProviderError('');
      setStatus('idle');
      if (initialTab) setTab(initialTab);
    }
  }
  // Theme previews show the variant these preferences draw now
  const resolvedVisualMode = useResolvedVisualMode(preferences.visualMode);

  // The latest preferences, for saves that run after this render (timer, blur, close)
  const latest = useRef(preferences);
  useLayoutEffect(() => {
    latest.current = preferences;
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kiroPhase = kiroSignIn.phase;

  const cancelPending = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
  };

  /**
   * Store the preferences, unless the default provider has no API key or Kiro is not ready.
   * `currentKiroStatus` is for a save that runs before the render with the new status.
   */
  const save = useCallback(
    (next: UserPreferences, currentKiroStatus: KiroStatus | undefined = kiroStatus) => {
      cancelPending();
      if (JSON.stringify(next) === JSON.stringify(loadPreferences())) return;
      if (!isProviderConfigured(next, next.preferredProvider)) {
        setProviderError(
          `Not saved. Add an API key for ${providerLabel(next.preferredProvider)}, or choose a different default provider.`
        );
        setStatus('not-saved');
        return;
      }
      const kiroError =
        next.preferredProvider === 'kiro' ? kiroDefaultProviderError(currentKiroStatus) : undefined;
      if (kiroError) {
        setProviderError(kiroError);
        setStatus('not-saved');
        return;
      }
      savePreferences(next);
      onChange(next);
      setProviderError('');
      setStatus('saved');
    },
    [onChange, kiroStatus]
  );

  const savePending = () => {
    if (pending.current) save(latest.current);
  };

  // "Saved" shows for a moment, then the footer says again that changes save automatically
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => setStatus('idle'), SAVED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => cancelPending, []);

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    // Two updates from one handler (a key and the primary search provider) both land
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    setPreferences(next);
    if (TYPED_KEYS.has(key)) {
      cancelPending();
      pending.current = setTimeout(() => save(latest.current), SAVE_DELAY_MS);
    } else {
      save(next);
    }
  };

  // Called by the hook when a sign-in that the app started ends signed in
  useLayoutEffect(() => {
    applyKiroDefault.current = (signedIn) => {
      if (!makeKiroDefault.current) return;
      makeKiroDefault.current = false;
      // A closed dialog has an old snapshot: the header can have changed the theme since then
      const next: UserPreferences = {
        ...(open ? latest.current : loadPreferences()),
        preferredProvider: 'kiro',
      };
      latest.current = next;
      setPreferences(next);
      // The hook passes the new status: the cached one still says signed out
      save(next, signedIn);
    };
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      savePending();
      // A sign-in that runs keeps its wish; an open form or an error does not
      if (kiroPhase !== 'starting' && kiroPhase !== 'waiting') makeKiroDefault.current = false;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Fixed height, so the tabs and the footer do not move between tabs */}
      <DialogContent
        className="sm:max-w-2xl h-[min(85vh,760px)] flex flex-col gap-4"
        // A typed value saves when focus leaves its field, or on Enter
        onBlur={savePending}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) savePending();
        }}
      >
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>Choose your providers, tools, and display settings.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as PreferencesTab)}
          className="flex min-h-0 w-full flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="web-search">Web Search</TabsTrigger>
            <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
          </TabsList>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="providers" className="mt-0">
              <ProviderSettings
                preferences={preferences}
                onUpdate={updatePreference}
                kiro={{
                  status: kiroStatus,
                  refresh: refreshKiro,
                  isRefreshing: isRefreshingKiro,
                  signIn: kiroSignIn,
                  setMakeDefault: (value) => {
                    makeKiroDefault.current = value;
                  },
                }}
              />
            </TabsContent>

            <TabsContent value="web-search" className="mt-0">
              <WebSearchSettings preferences={preferences} onUpdate={updatePreference} />
            </TabsContent>

            <TabsContent value="mcp" className="mt-0">
              <MCPServerSettings
                servers={preferences.mcpServers || {}}
                onChange={(mcpServers) => updatePreference('mcpServers', mcpServers)}
              />
            </TabsContent>

            <TabsContent value="display" className="mt-0 space-y-6">
              <div className="space-y-2">
                <Label>Color theme</Label>
                <ColorThemePicker
                  value={preferences.colorTheme}
                  visualMode={resolvedVisualMode}
                  onChange={(v) => updatePreference('colorTheme', v)}
                />
              </div>

              <div className="space-y-2">
                <p id="appearance-label" className="text-sm font-medium leading-none">
                  Appearance
                </p>
                <RadioGroup
                  aria-labelledby="appearance-label"
                  value={preferences.visualMode}
                  onValueChange={(v) => updatePreference('visualMode', v as VisualMode)}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="system" id="system" />
                    <Label htmlFor="system" className="font-normal">
                      System
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="light" id="light" />
                    <Label htmlFor="light" className="font-normal">
                      Light
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dark" id="dark" />
                    <Label htmlFor="dark" className="font-normal">
                      Dark
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <p id="density-label" className="text-sm font-medium leading-none">
                  Content density
                </p>
                <RadioGroup
                  aria-labelledby="density-label"
                  value={preferences.contentDensity}
                  onValueChange={(v) => updatePreference('contentDensity', v as ContentDensity)}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="comfortable" id="comfortable" />
                    <Label htmlFor="comfortable" className="font-normal">
                      Comfortable
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="compact" id="compact" />
                    <Label htmlFor="compact" className="font-normal">
                      Compact
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  Compact uses less space between messages and in the sidebar.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="initials">Avatar initials</Label>
                <Input
                  id="initials"
                  value={preferences.avatarInitials}
                  onChange={(e) =>
                    updatePreference('avatarInitials', validateInitials(e.target.value))
                  }
                  placeholder="AB"
                  maxLength={2}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  One or two letters shown next to your messages. Leave empty for no avatar.
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {providerError && (
          <p role="alert" className="text-sm text-destructive">
            {providerError}
          </p>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p role="status" className="text-sm text-muted-foreground">
            {status === 'saved' ? (
              <span className="text-status-ok">Saved</span>
            ) : status === 'not-saved' ? (
              <span className="text-destructive">Not saved</span>
            ) : (
              'Changes save automatically.'
            )}
          </p>
          {/* "Done", not "Close": the dialog's X button is already named Close */}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
