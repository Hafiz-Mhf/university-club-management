'use client';

import { Award, CalendarDays, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard } from '@/components/dashboard/kpi-card';
import {
  ActivityFeed,
  PendingApprovals,
  RecentRegistrations,
  UpcomingEvents,
} from '@/components/dashboard/widgets';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { ParticipantHome } from './participant-home';

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function CommitteeDashboard() {
  const { org } = useOrg();
  const dashboard = useDashboard(org.id, true);

  if (dashboard.isPending) {
    return (
      <main className="mx-auto w-full max-w-screen-2xl p-4 lg:p-6">
        <DashboardSkeleton />
      </main>
    );
  }

  if (dashboard.isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load the dashboard.</p>
        <Button variant="secondary" onClick={() => dashboard.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const data = dashboard.data;

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active members"
          value={data.kpis.activeMembers}
          icon={Users}
          hue={['text-info', 'bg-info/10']}
        />
        <KpiCard
          label="Events"
          value={data.kpis.totalEvents}
          icon={CalendarDays}
          hue={['text-domain-events', 'bg-domain-events/10']}
        />
        <KpiCard
          label="Active registrations"
          value={data.kpis.activeRegistrations}
          icon={Ticket}
          hue={['text-domain-registrations', 'bg-domain-registrations/10']}
        />
        <KpiCard
          label="Certificates issued"
          value={data.kpis.certificatesIssued}
          icon={Award}
          hue={['text-domain-certificates', 'bg-domain-certificates/10']}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <UpcomingEvents items={data.upcomingEvents} />
        <PendingApprovals items={data.pendingApprovals} />
        <RecentRegistrations items={data.recentRegistrations} />
        <ActivityFeed items={data.activityFeed} />
      </div>
    </main>
  );
}

export default function OrgHome() {
  const { membership } = useOrg();
  return isCommittee(membership.role) ? <CommitteeDashboard /> : <ParticipantHome />;
}
