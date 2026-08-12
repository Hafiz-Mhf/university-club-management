'use client';

import { UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MemberRoleBadge } from '@/components/members/member-role-badge';
import { useOrg } from '@/features/orgs/org-provider';

const joinedFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/**
 * Who you are signed in as. The account page opened straight onto consent
 * records before this — a page called "My account" that could not name the
 * account. Identity comes from the membership payload, which already carries
 * the user relation plus the org-specific details the committee holds.
 */
export function AccountIdentity() {
  const { org, membership } = useOrg();

  const details = (
    [
      ['Student ID', membership.studentId],
      ['Faculty', membership.faculty],
      ['Programme', membership.programme],
      ['Intake', membership.intake],
      ['Phone', membership.phone],
    ] satisfies [string, string | null][]
  ).filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border p-5">
      <div className="flex items-center gap-3">
        <Avatar className="size-11 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <UserRound className="size-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-heading text-lg font-semibold">{membership.user.fullName}</p>
          <p className="truncate text-sm text-foreground-muted">{membership.user.email}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
        <MemberRoleBadge role={membership.role} />
        <span>
          {org.name} · joined {joinedFmt.format(new Date(membership.joinedAt))}
        </span>
      </div>

      {details.length > 0 && (
        <dl className="grid gap-x-8 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-foreground-muted sm:w-28 sm:shrink-0">{label}</dt>
              <dd className="truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* These live on the membership, not the user, so they're per-org and
          only the committee can change them — say so rather than showing
          fields that look editable and aren't. */}
      <p className="text-xs text-foreground-subtle">
        These details are held by {org.name}. Ask a committee member to correct anything that&apos;s wrong.
      </p>
    </div>
  );
}
