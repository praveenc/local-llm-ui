import { Check, Copy } from 'lucide-react';

import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const lines = code.split('\n');

  return (
    <div className="relative group rounded-lg border bg-muted/50 overflow-hidden my-2">
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/80">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          {language || 'code'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Code content with line numbers */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm font-mono">
          <code>
            {lines.map((line, index) => (
              <div key={index} className="flex">
                <span
                  className={cn(
                    'select-none pr-4 text-right min-w-[3rem]',
                    'text-muted-foreground/50'
                  )}
                >
                  {index + 1}
                </span>
                <span className="flex-1 whitespace-pre">{line || ' '}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
