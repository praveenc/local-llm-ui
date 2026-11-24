import { Eye, EyeOff } from 'lucide-react';

import { useState } from 'react';
import type { ComponentProps } from 'react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

type SecretInputProps = Omit<ComponentProps<'input'>, 'type'>;

/** Password-style field with a show/hide toggle so a pasted key can be checked. */
export function SecretInput({ className, ...props }: SecretInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        // Monospace, so a revealed key shows l, 1 and I, or O and 0, apart
        className={cn('font-mono', className)}
        {...props}
        type={visible ? 'text' : 'password'}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Show API key"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
