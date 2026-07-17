import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCount } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  /** Domain-hue classes for the icon chip: [text color, tint background]. */
  hue: [string, string];
}

export function KpiCard({ label, value, icon: Icon, hue: [textClass, bgClass] }: KpiCardProps) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
            {label}
          </span>
          <span className="font-heading text-3xl font-semibold tabular-nums">
            {formatCount(value)}
          </span>
        </div>
        <div className={cn('flex size-8 items-center justify-center rounded-md', bgClass)}>
          <Icon className={cn('size-4', textClass)} />
        </div>
      </CardContent>
    </Card>
  );
}
