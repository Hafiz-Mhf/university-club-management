'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OrganizationTab } from '@/components/orgs/organization-tab';
import { MyAccountTab } from '@/components/account/my-account-tab';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { TabStrip, tabPanelId, tabId } from '@/components/ui/tab-strip';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

type Tab = 'organization' | 'account';

function SettingsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);

  const tabs = committee
    ? [
        { id: 'organization' as const, label: 'Organization' },
        { id: 'account' as const, label: 'My Account' },
      ]
    : [{ id: 'account' as const, label: 'My Account' }];

  // The URL is the source of truth, not local state: the sidebar links straight
  // to ?tab=account, and back/forward now steps through tabs instead of leaving
  // Settings entirely.
  const requested = params.get('tab');
  const tab: Tab = requested === 'account' || !committee ? 'account' : 'organization';

  const select = (next: Tab) => {
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <>
      {tabs.length > 1 && (
        <TabStrip label="Settings sections" tabs={tabs} value={tab} onChange={select} />
      )}

      {/* Both panels stay mounted, inactive one hidden. Unmounting the org form
          on a tab switch silently threw away whatever the user had typed. */}
      {committee && (
        <div
          role="tabpanel"
          id={tabPanelId('organization')}
          aria-labelledby={tabId('organization')}
          hidden={tab !== 'organization'}
        >
          <OrganizationTab orgId={org.id} role={membership.role} />
        </div>
      )}
      <div
        role="tabpanel"
        id={tabPanelId('account')}
        aria-labelledby={tabId('account')}
        hidden={tab !== 'account'}
      >
        <MyAccountTab />
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {/* useSearchParams client-side renders this subtree, so it needs its own
          boundary — and a placeholder rather than a blank page while it lands. */}
      <Suspense
        fallback={<SkeletonList rows={3} rowClassName="h-24" className="gap-6" label="Loading settings" />}
      >
        <SettingsTabs />
      </Suspense>
    </main>
  );
}
