import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'loading';
  children?: React.ReactNode;
  className?: string;
}

const statusConfig = {
  success: {
    variant: 'default' as const,
    className: 'bg-green-500 hover:bg-green-600',
  },
  error: {
    variant: 'destructive' as const,
    className: '',
  },
  warning: {
    variant: 'default' as const,
    className: 'bg-yellow-500 hover:bg-yellow-600',
  },
  info: {
    variant: 'secondary' as const,
    className: '',
  },
  loading: {
    variant: 'outline' as const,
    className: 'animate-pulse',
  },
};

export function StatusIndicator({ status, children, className }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {children}
    </Badge>
  );
}
