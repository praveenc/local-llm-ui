import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { Provider } from '../../utils/preferences';

interface ProviderInfo {
  label: string;
  icon: string;
  description: string;
}

const PROVIDERS: Record<Provider, ProviderInfo> = {
  bedrock: {
    label: 'Amazon Bedrock',
    icon: '/bedrock_bw.svg',
    description: 'AWS credentials',
  },
  'bedrock-mantle': {
    label: 'Bedrock Mantle',
    icon: '/bedrock-color.svg',
    description: 'API key required',
  },
  lmstudio: {
    label: 'LM Studio',
    icon: '/lmstudio_icon.svg',
    description: 'Port 1234',
  },
  ollama: {
    label: 'Ollama',
    icon: '/ollama_icon.svg',
    description: 'Port 11434',
  },
  groq: {
    label: 'Groq',
    icon: '/groq_icon.svg',
    description: 'API key required',
  },
  cerebras: {
    label: 'Cerebras',
    icon: '/cerebras_icon.svg',
    description: 'API key required',
  },
};

interface ProviderSelectProps {
  value: Provider;
  onValueChange: (provider: Provider) => void;
  disabled?: boolean;
}

export function ProviderSelect({ value, onValueChange, disabled }: ProviderSelectProps) {
  const currentProvider = PROVIDERS[value];

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as Provider)} disabled={disabled}>
      <SelectTrigger className="w-full h-9 text-sm">
        <SelectValue>
          <div className="flex items-center gap-2">
            <img src={currentProvider.icon} alt="" className="w-4 h-4" />
            <span>{currentProvider.label}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(PROVIDERS) as [Provider, ProviderInfo][]).map(([key, info]) => (
          <SelectItem key={key} value={key}>
            <div className="flex items-center gap-2">
              <img src={info.icon} alt="" className="w-4 h-4" />
              <div className="flex flex-col">
                <span>{info.label}</span>
                <span className="text-xs text-muted-foreground">{info.description}</span>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
