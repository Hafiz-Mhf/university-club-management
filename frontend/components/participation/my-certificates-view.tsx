'use client';

import { useMemo } from 'react';
import { Award, Download } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { eventDateRange } from '@/components/events/event-card';
import { useMyParticipation } from '@/features/participation/use-participation';
import { useMyCertificate } from '@/features/certificates/use-certificates';
import { useOrg } from '@/features/orgs/org-provider';
import type { ParticipationItem } from '@/types/api';
import { cn } from '@/lib/utils';

/**
 * The signed download URL is minted per event by `certificates/me`, and the
 * participation list deliberately does not bulk-mint file access — so each row
 * fetches its own URL. Only rows already known to have a certificate render
 * this, so it's one request per certificate the participant actually holds.
 */
function CertificateRow({ item }: { item: ParticipationItem }) {
  const { org } = useOrg();
  const certificate = useMyCertificate(org.id, item.event.id);

  return (
    <Card className="shadow-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/${org.slug}/events/${item.event.id}`}
            className="font-heading text-base font-semibold hover:text-primary"
          >
            {item.event.title}
          </Link>
          <span className="text-sm text-foreground-muted">{eventDateRange(item.event)}</span>
        </div>
        {certificate.isPending ? (
          <Skeleton className="h-8 w-36 rounded-md" />
        ) : certificate.data ? (
          <a
            href={certificate.data.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
          >
            <Download className="size-3.5" />
            Download certificate
          </a>
        ) : (
          <span className="text-sm text-foreground-muted">
            Couldn&apos;t load this certificate — reload to try again.
          </span>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Participant-facing Certificates. Previously this route told non-committee
 * members to go find their certificate on the event page instead.
 */
export function MyCertificatesView() {
  const { org } = useOrg();
  const participation = useMyParticipation(org.id);

  const certified = useMemo(
    () => (participation.data ?? []).filter((item) => item.hasCertificate),
    [participation.data],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold">My certificates</h1>
        <p className="text-sm text-foreground-muted">
          Certificates issued to you for events you attended.
        </p>
      </div>

      {participation.isPending && (
        <SkeletonList rows={2} rowClassName="h-20" className="gap-3" label="Loading your certificates" />
      )}

      {participation.isError && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-foreground-muted">Couldn&apos;t load your certificates.</p>
          <Button variant="secondary" onClick={() => participation.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {participation.data && certified.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
            <Award className="size-5 text-domain-certificates" />
          </div>
          <p className="font-medium">No certificates yet</p>
          <p className="max-w-sm text-sm text-foreground-muted">
            Attend an event and get checked in — organizers issue certificates afterwards, and
            they&apos;ll appear here.
          </p>
          <Link href={`/${org.slug}/events`} className={buttonVariants({ variant: 'secondary' })}>
            Browse events
          </Link>
        </div>
      )}

      <Refreshing
        active={participation.isFetching && !participation.isPending}
        label="Refreshing your certificates"
        className="flex flex-col gap-3"
      >
        {certified.map((item) => (
          <CertificateRow key={item.registrationId} item={item} />
        ))}
      </Refreshing>
    </main>
  );
}
