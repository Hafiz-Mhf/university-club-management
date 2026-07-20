'use client';

import { useState } from 'react';
import { OrganizationTab } from '@/components/orgs/organization-tab';
import { MyAccountTab } from '@/components/account/my-account-tab';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

type Tab = 'organization' | 'account';

export default function SettingsPage() {
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const [tab, setTab] = useState<Tab>(committee ? 'organization' : 'account');

  const tabs: { id: Tab; label: string }[] = committee
    ? [
        { id: 'organization', label: 'Organization' },
        { id: 'account', label: 'My Account' },
      ]
    : [{ id: 'account', label: 'My Account' }];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {tabs.length > 1 && (
        <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-sm px-3 py-1.5 text-sm font-medium',
                tab === t.id && 'bg-primary/10 text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'organization' && committee && (
        <OrganizationTab orgId={org.id} role={membership.role} />
      )}
      {tab === 'account' && <MyAccountTab />}
    </main>
  );
}
