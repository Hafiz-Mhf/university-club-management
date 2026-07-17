'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/features/auth/auth-store';
import { useSessionRestore } from '@/features/auth/use-session-restore';
import { setOnAuthFailure, setOnConsentStale } from '@/lib/api';

/**
 * Authenticated route group guard. Visual shell (sidebar/topbar) is layered
 * on in the org-scoped layout — this component only decides who may enter.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSessionRestore();
  const consentStale = useAuthStore((s) => s.consentStale);

  // Global handlers: a dead session goes to login, stale consent to renewal.
  useEffect(() => {
    setOnAuthFailure(() => router.replace('/login'));
    setOnConsentStale(() => router.replace(`/consent?next=${encodeURIComponent(pathname)}`));
    return () => {
      setOnAuthFailure(null);
      setOnConsentStale(null);
    };
  }, [router, pathname]);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && consentStale) {
      router.replace(`/consent?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, consentStale, router, pathname]);

  if (status !== 'authenticated' || consentStale) {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-foreground-subtle" aria-label="Loading" />
      </div>
    );
  }

  return <>{children}</>;
}
