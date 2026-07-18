'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, UserPlus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberRoleBadge } from '@/components/members/member-role-badge';
import { MemberStatusBadge } from '@/components/members/member-status-badge';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers } from '@/features/orgs/roles';
import type { MemberStatus, MembershipRole } from '@/types/api';

type RoleFilter = 'all' | MembershipRole;
type StatusFilter = 'all' | MemberStatus;

const ROLE_OPTIONS: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

export default function MembersPage() {
  const { org, membership } = useOrg();
  const canAdd = canManageMembers(membership.role);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Role/status filter server-side (the endpoint's own query params);
  // text search client-side on top of whatever the server returned.
  const members = useMembers(org.id, {
    role: roleFilter === 'all' ? undefined : roleFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const filtered = useMemo(() => {
    if (!members.data) return [];
    if (!search) return members.data;
    const q = search.toLowerCase();
    return members.data.filter(
      (m) => m.user.fullName.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [members.data, search]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Members</h1>
        {canAdd && (
          <Link href={`/${org.slug}/members/new`} className={buttonVariants()}>
            <UserPlus className="size-4" />
            Add member
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Search members by name or email"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          aria-label="Filter by role"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ALUMNI">Alumni</option>
        </select>
      </div>

      {members.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {members.isError && (
        <p className="py-12 text-center text-sm text-foreground-muted">
          Couldn&apos;t load members.
        </p>
      )}

      {members.data && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-foreground-muted">
          No members match your search or filter.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((m) => (
          <Link
            key={m.id}
            href={`/${org.slug}/members/${m.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{m.user.fullName}</span>
              <span className="text-xs text-foreground-muted">{m.user.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <MemberRoleBadge role={m.role} />
              <MemberStatusBadge status={m.status} />
              <span className="hidden text-xs text-foreground-subtle sm:inline">
                {relativeTime(m.joinedAt)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
