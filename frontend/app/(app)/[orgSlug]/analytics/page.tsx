'use client';

import { useState } from 'react';
import { Award, ChartNoAxesCombined, Download, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Refreshing } from '@/components/ui/refreshing';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { HorizontalBarChart } from '@/components/analytics/horizontal-bar-chart';
import { SingleSeriesLineChart } from '@/components/analytics/single-series-line-chart';
import { RatingsTrendChart } from '@/components/analytics/ratings-trend-chart';
import { FeedbackTable } from '@/components/analytics/feedback-table';
import {
  useAnalyticsOverview,
  useAnalyticsCertificates,
  useAnalyticsTrends,
  useAnalyticsDemographics,
  useCommitteeActivity,
  useAnalyticsFeedbackTrends,
} from '@/features/analytics/use-analytics';
import { formatPercent } from '@/features/analytics/format';
import { toBarData, committeeActivityToBarData } from '@/features/analytics/shape';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export default function AnalyticsPage() {
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const [days, setDays] = useState<Range>(30);

  const overview = useAnalyticsOverview(org.id);
  const certificates = useAnalyticsCertificates(org.id);
  const trends = useAnalyticsTrends(org.id, days);
  const demographics = useAnalyticsDemographics(org.id);
  const committeeActivity = useCommitteeActivity(org.id, days);
  const feedbackTrends = useAnalyticsFeedbackTrends(org.id, days);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <ChartNoAxesCombined className="size-5 text-domain-analytics" />
        </div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-foreground-muted">
          Analytics are for committee. Check back once you&apos;re part of the committee.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted">Trends over the last</span>
          <div
            className="flex w-fit rounded-md border border-border p-0.5"
            role="group"
            aria-label="Trend range"
          >
            {RANGES.map((r) => (
              <Button
                key={r}
                variant="ghost"
                size="sm"
                aria-pressed={days === r}
                onClick={() => setDays(r)}
                className={cn(days === r && 'bg-primary/10 text-primary')}
              >
                {r}d
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Attendance rate"
          value={overview.data?.attendanceRate ?? null}
          icon={Percent}
          hue={['text-domain-attendance', 'bg-domain-attendance/10']}
          format={formatPercent}
        />
        <KpiCard
          label="Certificates issued"
          value={certificates.data?.issued ?? null}
          icon={Award}
          hue={['text-domain-certificates', 'bg-domain-certificates/10']}
        />
        <KpiCard
          label="Certificates downloaded"
          value={certificates.data?.downloaded ?? null}
          icon={Download}
          hue={['text-domain-certificates', 'bg-domain-certificates/10']}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Growth &amp; registrations</h2>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Registration trend</p>
            {trends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={trends.isFetching} label="Refreshing registration trend">
                <SingleSeriesLineChart
                  data={(trends.data?.registrationTrend ?? []).map((t) => ({
                    date: t.date,
                    value: t.count,
                  }))}
                  label="Registrations"
                  color="var(--chart-2)"
                />
              </Refreshing>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Member growth</p>
            {trends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={trends.isFetching} label="Refreshing member growth">
                <SingleSeriesLineChart
                  data={(trends.data?.memberGrowth ?? []).map((t) => ({
                    date: t.date,
                    value: t.cumulativeActive,
                  }))}
                  label="Active members"
                  color="var(--chart-1)"
                />
              </Refreshing>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Demographics</h2>
        <p className="-mt-2 text-xs text-foreground-muted">
          All active members, not affected by the trend range above.
        </p>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Faculty</p>
            {demographics.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={demographics.isFetching} label="Refreshing faculty breakdown">
                <HorizontalBarChart
                  data={toBarData(demographics.data?.faculty ?? [])}
                  color="var(--chart-2)"
                  valueLabel="Members"
                />
              </Refreshing>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Programme</p>
            {demographics.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={demographics.isFetching} label="Refreshing programme breakdown">
                <HorizontalBarChart
                  data={toBarData(demographics.data?.programme ?? [])}
                  color="var(--chart-3)"
                  valueLabel="Members"
                />
              </Refreshing>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Committee activity</h2>
        <div className="rounded-lg border border-border p-4">
          {committeeActivity.isPending ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <Refreshing active={committeeActivity.isFetching} label="Refreshing committee activity">
              <HorizontalBarChart
                data={committeeActivityToBarData(committeeActivity.data?.data ?? [])}
                color="var(--chart-1)"
                valueLabel="Actions"
              />
            </Refreshing>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">NPS trend</p>
            {feedbackTrends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={feedbackTrends.isFetching} label="Refreshing NPS trend">
                <SingleSeriesLineChart
                  data={(feedbackTrends.data?.trend ?? []).map((t) => ({
                    date: t.date,
                    value: t.avgNpsScore,
                  }))}
                  label="NPS"
                  color="var(--chart-feedback)"
                  domain={[0, 10]}
                />
              </Refreshing>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Ratings trend</p>
            {feedbackTrends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <Refreshing active={feedbackTrends.isFetching} label="Refreshing ratings trend">
                <RatingsTrendChart
                  data={(feedbackTrends.data?.trend ?? []).map((t) => ({
                    date: t.date,
                    content: t.avgContentRating,
                    organization: t.avgOrganizationRating,
                    venue: t.avgVenueRating,
                  }))}
                />
              </Refreshing>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <FeedbackTable orgId={org.id} />
        </div>
      </section>
    </main>
  );
}
