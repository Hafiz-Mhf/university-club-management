import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auditActionSentence, relativeTime } from '@/features/dashboard/format';
import type { DashboardSummary } from '@/types/api';
import { cn } from '@/lib/utils';

function WidgetCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading text-base">{title}</CardTitle>
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-foreground-muted">{children}</p>;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function UpcomingEvents({ items }: { items: DashboardSummary['upcomingEvents'] }) {
  return (
    <WidgetCard title="Upcoming events" count={items.length}>
      {items.length === 0 && <EmptyLine>No upcoming events</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{e.title}</p>
              <p className="text-xs text-foreground-muted">
                {dateFmt.format(new Date(e.startAt))}
                {e.venue ? ` · ${e.venue}` : ''}
              </p>
            </div>
            <span className="shrink-0 text-xs text-foreground-muted tabular-nums">
              {e.registrationCount} registered
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/**
 * Titled "Waitlist", not "Pending approvals": every row in it is WAITLISTED,
 * and naming a state the product doesn't have sent people looking for an
 * approvals queue that never existed. Rows link straight into the event's
 * Registrations tab, where the approve action lives.
 */
export function PendingApprovals({
  items,
  orgSlug,
}: {
  items: DashboardSummary['pendingApprovals'];
  orgSlug: string;
}) {
  return (
    <WidgetCard title="Waitlist" count={items.length}>
      {items.length === 0 && <EmptyLine>Nobody is waiting for a seat</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={`/${orgSlug}/events/${r.eventId}?tab=registrations`}
              className="flex items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:text-primary"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.userName}</p>
                <p className="truncate text-xs text-foreground-muted">
                  {r.eventTitle} · waiting since {relativeTime(r.createdAt)}
                </p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 border-warning/40 bg-warning/10 text-warning"
              >
                Waitlisted
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="pt-2 text-xs text-foreground-muted">
          A seat frees up automatically when an approved registration is rejected or
          cancelled. Open an event to approve someone directly.
        </p>
      )}
    </WidgetCard>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  APPROVED: 'border-success/40 bg-success/10 text-success',
  WAITLISTED: 'border-warning/40 bg-warning/10 text-warning',
  CANCELLED: 'border-border bg-surface-secondary text-foreground-muted',
  REJECTED: 'border-danger/40 bg-danger/10 text-danger',
  PENDING: 'border-border bg-surface-secondary text-foreground-muted',
};

export function RecentRegistrations({
  items,
  orgSlug,
}: {
  items: DashboardSummary['recentRegistrations'];
  orgSlug: string;
}) {
  return (
    <WidgetCard title="Recent registrations" count={items.length}>
      {items.length === 0 && <EmptyLine>No registrations yet</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.userName}</p>
              <p className="truncate text-xs text-foreground-muted">
                <Link href={`/${orgSlug}/events/${r.eventId}`} className="hover:text-primary">
                  {r.eventTitle}
                </Link>{' '}
                · {relativeTime(r.createdAt)}
              </p>
            </div>
            <Badge variant="outline" className={cn('shrink-0 capitalize', STATUS_CLASSES[r.status])}>
              {r.status.toLowerCase()}
            </Badge>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

export function ActivityFeed({ items }: { items: DashboardSummary['activityFeed'] }) {
  return (
    <WidgetCard title="Activity" count={items.length}>
      {items.length === 0 && <EmptyLine>No activity yet</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
            <p className="min-w-0 truncate text-sm">
              {a.actorName ? (
                <>
                  <span className="font-medium">{a.actorName}</span>{' '}
                  <span className="text-foreground-muted">{auditActionSentence(a.action)}</span>
                </>
              ) : (
                <span className="text-foreground-muted first-letter:uppercase">
                  {auditActionSentence(a.action)}
                </span>
              )}
            </p>
            <span className="shrink-0 text-xs text-foreground-subtle">
              {relativeTime(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
