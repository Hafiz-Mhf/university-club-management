import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssetCondition } from '@/types/api';

// Semantic tokens — condition is a real status signal (good/degraded/
// gone), unlike FileCategoryBadge's plain outline (category is identity,
// not status).
const STATUS_STYLES: Record<AssetCondition, { label: string; className: string }> = {
  GOOD: { label: 'Good', className: 'border-success/40 bg-success/10 text-success' },
  DAMAGED: { label: 'Damaged', className: 'border-warning/40 bg-warning/10 text-warning' },
  LOST: { label: 'Lost', className: 'border-danger/40 bg-danger/10 text-danger' },
};

export function AssetConditionBadge({ condition }: { condition: AssetCondition }) {
  const { label, className } = STATUS_STYLES[condition];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
