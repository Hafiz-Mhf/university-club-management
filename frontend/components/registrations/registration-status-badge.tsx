import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RegistrationStatus } from '@/types/api';

// Registration status uses semantic tokens, never the domain-registrations
// hue (which belongs to nav/icons per design.md).
const STATUS_STYLES: Record<RegistrationStatus, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'border-success/40 bg-success/10 text-success' },
  WAITLISTED: { label: 'Waitlisted', className: 'border-warning/40 bg-warning/10 text-warning' },
  REJECTED: { label: 'Rejected', className: 'border-danger/40 bg-danger/10 text-danger' },
  CANCELLED: {
    label: 'Cancelled',
    className: 'border-border bg-surface-secondary text-foreground-muted',
  },
};

export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
