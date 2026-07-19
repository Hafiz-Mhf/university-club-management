'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MinutesForm } from '@/components/minutes/minutes-form';
import { useCreateMinutes } from '@/features/minutes/use-minutes';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function NewMinutesPage() {
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const create = useCreateMinutes(org.id);

  // The backend would 403 the POST anyway — just don't show a dead-end form.
  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/workspace`);
  }, [committee, router, org.slug]);
  if (!committee) return null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">New minutes</h1>
      <MinutesForm
        orgId={org.id}
        mode="create"
        isPending={create.isPending}
        error={create.error}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (minutes) => router.push(`/${org.slug}/workspace/minutes/${minutes.id}`),
          })
        }
      />
    </main>
  );
}
