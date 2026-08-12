import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

// Role is not a success/failure signal — plain outline, no color-coding
// (unlike event/registration status badges).
export function MemberRoleBadge({ role }: { role: MembershipRole }) {
  return (
    <Badge variant="outline" className="shrink-0">
      {ROLE_LABELS[role]}
    </Badge>
  );
}
