'use client';

import { OrgSwitcher } from '@/components/shell/org-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useOrg } from '@/features/orgs/org-provider';
import { Button } from '@/components/ui/button';

// Temporary org landing — replaced by the Dashboard page in Task 6.
export default function OrgHome() {
  const { org, membership } = useOrg();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <div className="w-64">
          <OrgSwitcher />
        </div>
        <ThemeToggle />
      </div>
      <h1 className="text-3xl font-semibold">{org.name}</h1>
      <p className="text-foreground-muted">
        Your role here: <span className="font-medium text-foreground">{membership.role}</span>
      </p>
      <div>
        <Button>Org-branded primary</Button>
      </div>
    </main>
  );
}
