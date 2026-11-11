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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { isProviderConfigured, loadPreferences, savePreferences } from '../../utils/preferences';
import type { UserPreferences, VisualMode } from '../../utils/preferences';
import { ColorThemePicker } from './ColorThemePicker';
import { MCPServerSettings } from './MCPServerSettings';
import { ProviderSettings } from './ProviderSettings';
import { WebSearchSettings } from './WebSearchSettings';
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
  const [providerError, setProviderError] = useState('');

  const handleSave = () => {
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
                  visualMode={preferences.visualMode}
                  onChange={(v) => updatePreference('colorTheme', v)}
                />
              </div>

              <div className="space-y-2">
                <Label>Appearance</Label>
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
