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

export function PendingApprovals({ items }: { items: DashboardSummary['pendingApprovals'] }) {
  return (
    <WidgetCard title="Pending approvals" count={items.length}>
      {items.length === 0 && <EmptyLine>Nothing waiting for review</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.eventTitle}</p>
              <p className="text-xs text-foreground-muted">waitlisted {relativeTime(r.createdAt)}</p>
            </div>
            <Badge
              variant="outline"
              className="shrink-0 border-warning/40 bg-warning/10 text-warning"
            >
              Waitlisted
            </Badge>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="pt-2 text-xs text-foreground-subtle">
          Approve or reject from the Events page (a later slice).
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

export function RecentRegistrations({ items }: { items: DashboardSummary['recentRegistrations'] }) {
  return (
    <WidgetCard title="Recent registrations" count={items.length}>
      {items.length === 0 && <EmptyLine>No registrations yet</EmptyLine>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.eventTitle}</p>
              <p className="text-xs text-foreground-muted">{relativeTime(r.createdAt)}</p>
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
            {/* The feed carries actor ids, not names (backend keeps PII out) —
                render the action itself rather than a fake "Someone …". */}
            <p className="min-w-0 truncate text-sm first-letter:uppercase">
              {auditActionSentence(a.action)}
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
