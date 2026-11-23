import { Check, Copy, X } from 'lucide-react';
import { toast } from 'sonner';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface CopyToClipboardProps {
  text: string;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function CopyToClipboard({
  text,
  className,
  variant = 'ghost',
  size = 'icon',
}: CopyToClipboardProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      // sonner is announced by the global Toaster live region
      toast.success('Copied');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
      setStatus('failed');
      toast.error('Copy failed');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  const label =
    status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy to clipboard';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={handleCopy}
            className={cn(className)}
            aria-label={label}
          >
            {status === 'copied' ? (
              <Check className="h-4 w-4" />
            ) : status === 'failed' ? (
              <X className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
