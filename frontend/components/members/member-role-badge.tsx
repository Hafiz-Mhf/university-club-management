import { Badge } from '@/components/ui/badge';
import type { MembershipRole } from '@/types/api';

// Role is not a success/failure signal — plain outline, no color-coding
// (unlike event/registration status badges).
const ROLE_LABELS: Record<MembershipRole, string> = {
  PRESIDENT: 'President',
  VICE_PRESIDENT: 'Vice President',
  SECRETARY: 'Secretary',
  TREASURER: 'Treasurer',
  EVENT_DIRECTOR: 'Event Director',
  COMMITTEE: 'Committee',
  VOLUNTEER: 'Volunteer',
  PARTICIPANT: 'Participant',
  ADVISOR: 'Advisor',
};

export function MemberRoleBadge({ role }: { role: MembershipRole }) {
  return (
    <Badge variant="outline" className="shrink-0">
      {ROLE_LABELS[role]}
    </Badge>
  );
}
