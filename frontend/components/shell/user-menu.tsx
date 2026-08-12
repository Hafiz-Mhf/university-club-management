'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, Loader2, LogOut, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useLogout } from '@/features/auth/use-auth';
import { useOrg } from '@/features/orgs/org-provider';
import { ROLE_LABELS } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

/**
 * The sidebar's account block. This used to be an unlabelled 32px avatar that
 * opened a dropdown — first-time users could not find their account or the way
 * out at all. Both are now named, full-width rows that are always on screen.
 */
export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();
  const { org, membership } = useOrg();

  const accountHref = `/${org.slug}/settings?tab=account`;
  const onAccount = pathname === `/${org.slug}/settings`;

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={accountHref}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors',
          onAccount ? 'bg-primary/10' : 'hover:bg-sidebar-accent',
        )}
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <UserRound className="size-3.5" />
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col text-left">
          <span className="truncate text-sm font-medium">My account</span>
          <span className="truncate text-xs text-foreground-muted">
            {ROLE_LABELS[membership.role]}
          </span>
        </span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-foreground-subtle" aria-hidden />
      </Link>

      <button
        type="button"
        disabled={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, { onSettled: () => router.replace('/login') })
        }
        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
      >
        {logout.isPending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : (
          <LogOut className="size-4 shrink-0" />
        )}
        Sign out
      </button>
    </div>
  );
}
