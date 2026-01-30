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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { loadPreferences, savePreferences, validateInitials } from '../../utils/preferences';
import type {
  ContentDensity,
  Provider,
  UserPreferences,
  VisualMode,
} from '../../utils/preferences';

const MANTLE_REGIONS = [
  { label: 'US East (N. Virginia)', value: 'us-east-1' },
  { label: 'US East (Ohio)', value: 'us-east-2' },
  { label: 'US West (Oregon)', value: 'us-west-2' },
  { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
  { label: 'Europe (Frankfurt)', value: 'eu-central-1' },
  { label: 'Europe (Ireland)', value: 'eu-west-1' },
];

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (preferences: UserPreferences) => void;
}

export function PreferencesDialog({ open, onOpenChange, onSave }: PreferencesDialogProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [initialsError, setInitialsError] = useState('');

  const handleSave = () => {
    if (!validateInitials(preferences.avatarInitials)) {
      setInitialsError('Please enter 1-2 letters');
      return;
    }
    savePreferences(preferences);
    onSave(preferences);
    onOpenChange(false);
  };

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    if (key === 'avatarInitials') setInitialsError('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>Configure your chat experience and API settings.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="provider" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="provider">Provider</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
          </TabsList>

          <TabsContent value="provider" className="space-y-4 mt-4">
            <div className="space-y-3">
              <Label>Default Provider</Label>
              <RadioGroup
                value={preferences.preferredProvider}
                onValueChange={(v) => updatePreference('preferredProvider', v as Provider)}
                className="grid gap-2"
              >
                {[
                  {
                    value: 'bedrock',
                    label: 'Amazon Bedrock',
                    icon: '/bedrock_bw.svg',
                    desc: 'AWS credentials',
                  },
                  {
                    value: 'bedrock-mantle',
                    label: 'Bedrock Mantle',
                    icon: '/bedrock-color.svg',
                    desc: 'API key',
                  },
                  {
                    value: 'lmstudio',
                    label: 'LM Studio',
                    icon: '/lmstudio_icon.svg',
                    desc: 'Port 1234',
                  },
                  {
                    value: 'ollama',
                    label: 'Ollama',
                    icon: '/ollama_icon.svg',
                    desc: 'Port 11434',
                  },
                  { value: 'groq', label: 'Groq', icon: '/groq_icon.svg', desc: 'API key' },
                  {
                    value: 'cerebras',
                    label: 'Cerebras',
                    icon: '/cerebras_icon.svg',
                    desc: 'API key',
                  },
                ].map((provider) => (
                  <div key={provider.value} className="flex items-center space-x-3">
                    <RadioGroupItem value={provider.value} id={provider.value} />
                    <Label
                      htmlFor={provider.value}
                      className="flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <img src={provider.icon} alt="" className="w-4 h-4" />
                      <span>{provider.label}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{provider.desc}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </TabsContent>

          <TabsContent value="api-keys" className="space-y-4 mt-4">
            <div className="space-y-3">
              <Label htmlFor="mantle-key">Bedrock Mantle API Key</Label>
              <Input
                id="mantle-key"
                type="password"
                value={preferences.bedrockMantleApiKey || ''}
                onChange={(e) => updatePreference('bedrockMantleApiKey', e.target.value)}
                placeholder="Enter API key"
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="mantle-region">Mantle Region</Label>
              <Select
                value={preferences.bedrockMantleRegion || 'us-west-2'}
                onValueChange={(v) => updatePreference('bedrockMantleRegion', v)}
              >
                <SelectTrigger id="mantle-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANTLE_REGIONS.map((region) => (
                    <SelectItem key={region.value} value={region.value}>
                      {region.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label htmlFor="groq-key">Groq API Key</Label>
              <Input
                id="groq-key"
                type="password"
                value={preferences.groqApiKey || ''}
                onChange={(e) => updatePreference('groqApiKey', e.target.value)}
                placeholder="Enter API key"
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="cerebras-key">Cerebras API Key</Label>
              <Input
                id="cerebras-key"
                type="password"
                value={preferences.cerebrasApiKey || ''}
                onChange={(e) => updatePreference('cerebrasApiKey', e.target.value)}
                placeholder="Enter API key"
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="tavily-key">Tavily API Key (Web Search)</Label>
              <Input
                id="tavily-key"
                type="password"
                value={preferences.tavilyApiKey || ''}
                onChange={(e) => updatePreference('tavilyApiKey', e.target.value)}
                placeholder="Enter API key for web search"
              />
              <p className="text-xs text-muted-foreground">
                Get your API key at{' '}
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

          <TabsContent value="display" className="space-y-4 mt-4">
            <div className="space-y-3">
              <Label htmlFor="initials">Avatar Initials</Label>
              <Input
                id="initials"
                value={preferences.avatarInitials}
                onChange={(e) => updatePreference('avatarInitials', e.target.value.toUpperCase())}
                placeholder="AB"
                maxLength={2}
                className={initialsError ? 'border-destructive' : ''}
              />
              {initialsError && <p className="text-sm text-destructive">{initialsError}</p>}
            </div>

            <div className="space-y-3">
              <Label>Theme</Label>
              <RadioGroup
                value={preferences.visualMode}
                onValueChange={(v) => updatePreference('visualMode', v as VisualMode)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="light" id="light" />
                  <Label htmlFor="light">Light</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dark" id="dark" />
                  <Label htmlFor="dark">Dark</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>Content Density</Label>
              <RadioGroup
                value={preferences.contentDensity}
                onValueChange={(v) => updatePreference('contentDensity', v as ContentDensity)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="comfortable" id="comfortable" />
                  <Label htmlFor="comfortable">Comfortable</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="compact" id="compact" />
                  <Label htmlFor="compact">Compact</Label>
                </div>
              </RadioGroup>
            </div>
          </TabsContent>
        </Tabs>

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
