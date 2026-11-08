import { useState } from 'react';

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

import {
  isProviderConfigured,
  loadPreferences,
  savePreferences,
  validateInitials,
} from '../../utils/preferences';
import type { ContentDensity, UserPreferences, VisualMode } from '../../utils/preferences';
import { MCPServerSettings } from './MCPServerSettings';
import { ProviderSettings } from './ProviderSettings';
import { providerLabel } from './providerOptions';

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (preferences: UserPreferences) => void;
}

type PreferencesTab = 'providers' | 'web-search' | 'mcp' | 'display';

export function PreferencesDialog({ open, onOpenChange, onSave }: PreferencesDialogProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [tab, setTab] = useState<PreferencesTab>('providers');
  const [wasOpen, setWasOpen] = useState(open);

  // Reload on open: other controls (the header theme toggle) also save preferences
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPreferences(loadPreferences());
  }
  const [initialsError, setInitialsError] = useState('');
  const [providerError, setProviderError] = useState('');

  const handleSave = () => {
    if (!validateInitials(preferences.avatarInitials)) {
      setInitialsError('Please enter 1-2 letters');
      setTab('display');
      return;
    }
    if (!isProviderConfigured(preferences, preferences.preferredProvider)) {
      setProviderError(
        `Add an API key for ${providerLabel(preferences.preferredProvider)}, or choose a different default provider.`
      );
      setTab('providers');
      return;
    }
    savePreferences(preferences);
    onSave(preferences);
    onOpenChange(false);
  };

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    if (key === 'avatarInitials') setInitialsError('');
    setProviderError('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-4">
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
              <ProviderSettings preferences={preferences} onUpdate={updatePreference} />
            </TabsContent>

            <TabsContent value="web-search" className="mt-0 space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Tavily web search</h3>
                <p className="text-xs text-muted-foreground">
                  With a key set, the globe button in the chat input lets the model search the web.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tavily-key">Tavily API key</Label>
                <Input
                  id="tavily-key"
                  type="password"
                  autoComplete="off"
                  value={preferences.tavilyApiKey || ''}
                  onChange={(e) => updatePreference('tavilyApiKey', e.target.value.trim())}
                  placeholder="Paste your API key"
                />
                <p className="text-xs text-muted-foreground">
                  Get a key at{' '}
                  <a
                    href="https://tavily.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    tavily.com
                  </a>
                </p>
              </div>
            </TabsContent>

            <TabsContent value="mcp" className="mt-0">
              <MCPServerSettings
                servers={preferences.mcpServers || {}}
                onChange={(mcpServers) => updatePreference('mcpServers', mcpServers)}
              />
            </TabsContent>

            <TabsContent value="display" className="mt-0 space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="initials">Avatar initials</Label>
                <Input
                  id="initials"
                  value={preferences.avatarInitials}
                  onChange={(e) => updatePreference('avatarInitials', e.target.value.toUpperCase())}
                  placeholder="AB"
                  maxLength={2}
                  className={initialsError ? 'w-24 border-destructive' : 'w-24'}
                />
                {initialsError && <p className="text-sm text-destructive">{initialsError}</p>}
              </div>

              <div className="space-y-2">
                <Label>Theme</Label>
                <RadioGroup
                  value={preferences.visualMode}
                  onValueChange={(v) => updatePreference('visualMode', v as VisualMode)}
                  className="flex gap-4"
                >
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
                <Label>Content density</Label>
                <RadioGroup
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
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {providerError && (
          <p role="alert" className="text-sm text-destructive">
            {providerError}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
