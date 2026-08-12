'use client';

import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AttendanceStatusBadge } from '@/components/attendance/attendance-status-badge';
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import { eventDateRange } from '@/components/events/event-card';
import { NEXT_ACTION_LABEL, nextAction, statusExplanation } from '@/features/participation/status';
import type { ParticipationItem } from '@/types/api';

interface ParticipationRowProps {
  item: ParticipationItem;
  orgSlug: string;
  now: Date;
  /** Attendance badges are noise on surfaces that aren't about turning up. */
  showAttendance?: boolean;
}

/**
 * One event this participant is in, as they experience it: where and when,
 * where their registration stands, and the single next thing to do. Links to
 * the event page, which stays the one place actions actually happen.
 */
export function ParticipationRow({
  item,
  orgSlug,
  now,
  showAttendance = true,
}: ParticipationRowProps) {
  const explanation = statusExplanation(item.status);
  const action = nextAction(item, now);

  return (
    <Link href={`/${orgSlug}/events/${item.event.id}`} className="group">
      <Card className="shadow-card transition-colors group-hover:border-primary/40">
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <h3 className="font-heading text-base font-semibold">{item.event.title}</h3>
            <div className="flex shrink-0 items-center gap-1.5">
              <RegistrationStatusBadge status={item.status} />
              {showAttendance && item.attendance && (
                <AttendanceStatusBadge status={item.attendance.status} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {eventDateRange(item.event)}
            </span>
            {item.event.venue && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {item.event.venue}
              </span>
            )}
          </div>

          {explanation && <p className="text-sm text-foreground-muted">{explanation}</p>}

          {action && (
            <span className="text-sm font-medium text-primary">
              {NEXT_ACTION_LABEL[action]} →
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
