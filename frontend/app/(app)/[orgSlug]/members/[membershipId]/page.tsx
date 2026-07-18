'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberRoleBadge } from '@/components/members/member-role-badge';
import { MemberStatusBadge } from '@/components/members/member-status-badge';
import { MemberNotFound } from '@/components/members/member-not-found';
import { ChangeRoleDialog } from '@/components/members/change-role-dialog';
import { useMembers, useRemoveMember } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers, canManageRoles } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

const PROFILE_FIELDS = [
  ['studentId', 'Student ID'],
  ['faculty', 'Faculty'],
  ['programme', 'Programme'],
  ['intake', 'Intake'],
  ['phone', 'Phone'],
] as const;

export default function MemberDetailPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const { membershipId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  // No GET /members/:id exists — find the row in the org-scoped list.
  const members = useMembers(org.id, {});
  const remove = useRemoveMember(org.id);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (members.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  const member = members.data?.find((m) => m.id === membershipId);
  if (!member) return <MemberNotFound />;

  const canEdit = canManageMembers(membership.role);
  const canManageThisRole = canManageRoles(membership.role);
  const history = member.committeeHistory ?? [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/members`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All members
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{member.user.fullName}</h1>
          <MemberRoleBadge role={member.role} />
          <MemberStatusBadge status={member.status} />
        </div>
        {canEdit && (
          <Link
            href={`/${org.slug}/members/${member.id}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      <p className="text-sm text-foreground-muted">{member.user.email}</p>

      <div className="flex flex-col gap-1 text-sm">
        {PROFILE_FIELDS.map(([key, label]) =>
          member[key] ? (
            <span key={key}>
              <span className="text-foreground-muted">{label}:</span> {member[key]}
            </span>
          ) : null,
        )}
      </div>

      {history.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground-muted">Committee history</h2>
          <ul className="flex flex-col gap-0.5 text-sm text-foreground-muted">
            {history.map((h, i) => (
              <li key={i}>
                Was {h.role.replace('_', ' ')} until {new Date(h.until).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManageThisRole && (
        <div className="flex flex-col gap-2">
          {removeError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {removeError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setRoleDialogOpen(true)}>
              Change role
            </Button>
            <Button variant="destructive" onClick={() => setConfirmingRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      )}

      <ChangeRoleDialog
        orgId={org.id}
        member={member}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
      />

      <Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {member.user.fullName}?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep member
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                setRemoveError(null);
                remove.mutate(member.id, {
                  onSuccess: () => router.push(`/${org.slug}/members`),
                  onError: (e) => {
                    setRemoveError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
