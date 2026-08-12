'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/shell/org-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { UserMenu } from '@/components/shell/user-menu';
import { NAV_ITEMS, navLabel } from '@/components/shell/nav-items';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <OrgSwitcher />
      {/* min-h-0 + overflow lets the nav scroll on short viewports instead of
          pushing the account block off the bottom of the sidebar. */}
      <nav
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-2"
        aria-label="Main navigation"
      >
        {NAV_ITEMS.filter((item) => item.minTier === 'member' || committee).map((item) => {
          const href = item.segment ? `/${org.slug}/${item.segment}` : `/${org.slug}`;
          const active = pathname === href;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-foreground'
                  : 'text-foreground-muted hover:bg-sidebar-accent hover:text-foreground',
              )}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-0.75 rounded-full bg-primary" />
              )}
              <Icon
                className={cn('size-4 shrink-0', active ? 'text-primary' : item.iconClass)}
              />
              {navLabel(item, committee)}
            </Link>
          );
        })}
      </nav>
      {/* Pinned: account and sign-out stay visible however long the nav gets. */}
      <div className="shrink-0 border-t border-sidebar-border pt-2">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <UserMenu onNavigate={onNavigate} />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    // Pinned to the viewport: the page below scrolls, the sidebar (and the
    // account block at its foot) does not scroll out of reach.
    <aside className="hidden w-65 shrink-0 border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:block lg:h-dvh">
      <SidebarNav />
    </aside>
  );
}
