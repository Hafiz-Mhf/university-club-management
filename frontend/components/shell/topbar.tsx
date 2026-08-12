'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { SidebarNav } from '@/components/shell/sidebar';
import { NAV_ITEMS, navLabel } from '@/components/shell/nav-items';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export function Topbar() {
  const pathname = usePathname();
  const { org, membership } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);

  const segment = pathname.split('/').filter(Boolean)[1] ?? '';
  const item = NAV_ITEMS.find((i) => i.segment === segment);
  // Breadcrumb must match the heading the page actually renders for this role.
  const current = item ? navLabel(item, isCommittee(membership.role)) : 'Dashboard';

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          aria-label="Open navigation"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'lg:hidden')}
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-70 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate text-foreground-muted">{org.name}</span>
        <span className="text-foreground-subtle">/</span>
        <span className="truncate font-medium">{current}</span>
      </nav>
      {/* Right side reserved for the future command palette (⌘K). */}
      <div className="ml-auto" />
    </header>
  );
}
