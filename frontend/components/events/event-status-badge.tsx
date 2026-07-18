import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { EventStatus } from '@/types/api';

// Status uses semantic tokens, never domain hues — the events domain violet
// belongs to nav/icons, not to lifecycle state.
const STATUS_STYLES: Record<EventStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'border-border bg-surface-secondary text-foreground-muted' },
  PUBLISHED: { label: 'Published', className: 'border-success/40 bg-success/10 text-success' },
  COMPLETED: { label: 'Completed', className: 'border-info/40 bg-info/10 text-info' },
  CANCELLED: { label: 'Cancelled', className: 'border-danger/40 bg-danger/10 text-danger' },
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
