'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRenewConsent } from '@/features/auth/use-auth';

function ConsentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const renew = useRenewConsent();

  const next = searchParams.get('next');
  // Never bounce back to /consent itself (redirect-loop guard).
  const destination = next && !next.startsWith('/consent') ? next : '/';

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="size-5 text-primary" />
        </div>
        <CardTitle className="text-2xl">Privacy policy updated</CardTitle>
        <CardDescription>
          Our privacy policy has changed since you last agreed (current version: v1). Please review
          and renew your consent to continue using your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-foreground-muted">
          Until you agree, you can still view your consent history, export your data, or delete your
          account.
        </p>
        {renew.error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            Something went wrong — please try again
          </p>
        )}
        <Button
          onClick={() => renew.mutate(undefined, { onSuccess: () => router.replace(destination) })}
          disabled={renew.isPending}
        >
          {renew.isPending && <Loader2 className="size-4 animate-spin" />}
          I agree to the updated policy
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ConsentPage() {
  return (
    <Suspense>
      <ConsentContent />
    </Suspense>
  );
}
