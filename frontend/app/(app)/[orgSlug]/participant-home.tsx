'use client';

import { Sparkles } from 'lucide-react';
import { useOrg } from '@/features/orgs/org-provider';

/**
 * Landing for non-committee roles — the dashboard endpoint is
 * MANAGE_EVENTS-gated server-side, so we never fire that query for them.
 */
export function ParticipantHome() {
  const { org, membership } = useOrg();
  const role = membership.role.toLowerCase().replace(/_/g, ' ');

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="size-5 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold">Welcome to {org.name}</h1>
      <p className="max-w-md text-sm text-foreground-muted">
        You&apos;re a <span className="font-medium text-foreground">{role}</span> here. Event
        browsing, registrations, and your certificates arrive in upcoming slices.
      </p>
    </div>
  );
}
