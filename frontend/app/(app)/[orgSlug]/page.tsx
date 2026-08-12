'use client';

import { Award, CalendarDays, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonList
        rows={4}
        rowClassName="h-24"
        className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        label="Loading dashboard metrics"
      />
      <SkeletonList
        rows={4}
        rowClassName="h-64"
        className="grid gap-4 lg:grid-cols-2"
        label="Loading dashboard widgets"
      />
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
      {/* KPIs and widgets refresh together after any registration or event
          write — dim the whole board rather than letting numbers change
          silently under the reader. */}
      <Refreshing
        active={dashboard.isFetching}
        label="Refreshing dashboard"
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
          <PendingApprovals items={data.pendingApprovals} orgSlug={org.slug} />
          <RecentRegistrations items={data.recentRegistrations} orgSlug={org.slug} />
          <ActivityFeed items={data.activityFeed} />
        </div>
      </Refreshing>
    </main>
  );
}

export default function OrgHome() {
  const { membership } = useOrg();
  return isCommittee(membership.role) ? <CommitteeDashboard /> : <ParticipantHome />;
}
