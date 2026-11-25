/**
 * KiroUsageLine
 *
 * The plan and the credits of the Kiro account on one line, for example
 * "Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec". It shows nothing while the answer
 * loads and when Kiro cannot tell.
 */
import { useKiroUsage } from '@/hooks/useKiroUsage';
import { formatKiroUsageLine } from '@/utils/kiroUsage';

interface KiroUsageLineProps {
  className?: string;
  /** A small label above the line. It shows only when the line shows. */
  label?: string;
}

export function KiroUsageLine({ className, label }: KiroUsageLineProps) {
  const usage = useKiroUsage();
  if (!usage) return null;
  const line = <p className={className}>{formatKiroUsageLine(usage)}</p>;
  if (!label) return line;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {line}
    </div>
  );
}
