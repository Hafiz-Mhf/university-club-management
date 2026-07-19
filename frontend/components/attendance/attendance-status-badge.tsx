import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@/types/api';

const STATUS_STYLES: Record<AttendanceStatus, { label: string; className: string }> = {
  REGISTERED: {
    label: 'Registered',
    className: 'border-border bg-surface-secondary text-foreground-muted',
  },
  PRESENT: { label: 'Present', className: 'border-success/40 bg-success/10 text-success' },
  ABSENT: { label: 'Absent', className: 'border-danger/40 bg-danger/10 text-danger' },
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
