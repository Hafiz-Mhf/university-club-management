'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useOrgs } from '@/features/orgs/use-orgs';

/** Root entry: forward to the user's first org, or onboarding when they have none. */
export default function RootRedirect() {
  const router = useRouter();
  const orgs = useOrgs();

  useEffect(() => {
    if (!orgs.data) return;
    router.replace(orgs.data.length > 0 ? `/${orgs.data[0].slug}` : '/welcome');
  }, [orgs.data, router]);

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-foreground-subtle" aria-label="Loading" />
    </div>
  );
}
