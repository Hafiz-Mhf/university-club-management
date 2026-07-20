'use client';

import { OrganizationProfileForm } from '@/components/orgs/organization-profile-form';
import { BrandingPanel } from '@/components/orgs/branding-panel';
import { OrgColorForm } from '@/components/orgs/org-color-form';
import { PublicPageLink } from '@/components/orgs/public-page-link';
import { useOrgDetail } from '@/features/orgs/use-orgs';
import { canManageOrgColors, canManageOrgProfile } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

export function OrganizationTab({ orgId, role }: { orgId: string; role: MembershipRole }) {
  const org = useOrgDetail(orgId);

  if (org.isPending) return null;
  if (org.isError || !org.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load organization details.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <OrganizationProfileForm orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Branding</h2>
        <BrandingPanel orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Colors</h2>
        <OrgColorForm orgId={orgId} org={org.data} canManage={canManageOrgColors(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Public page</h2>
        <PublicPageLink slug={org.data.slug} />
      </section>
    </div>
  );
}
