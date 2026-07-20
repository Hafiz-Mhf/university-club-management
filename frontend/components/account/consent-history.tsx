'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useConsents } from '@/features/pdpa/use-pdpa';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ConsentHistory() {
  const consents = useConsents();

  if (consents.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (consents.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load consent history.</p>;
  }
  if (consents.data.length === 0) {
    return <p className="text-sm text-foreground-muted">No consent records yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {consents.data.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <span className="capitalize">{c.purpose}</span>
          <span className="text-foreground-muted">
            Policy {c.policyVersion} · {dateFmt.format(new Date(c.grantedAt))}
          </span>
        </li>
      ))}
    </ul>
  );
}
