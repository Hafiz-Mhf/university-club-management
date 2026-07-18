import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MemberStatus } from '@/types/api';

// Semantic tokens only — same family as EventStatusBadge and
// RegistrationStatusBadge. Members has no domain hue by design.
const STATUS_STYLES: Record<MemberStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'border-success/40 bg-success/10 text-success' },
  ALUMNI: { label: 'Alumni', className: 'border-border bg-surface-secondary text-foreground-muted' },
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
