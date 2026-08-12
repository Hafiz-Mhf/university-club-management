'use client';

import { OrganizationProfileForm } from '@/components/orgs/organization-profile-form';
import { BrandingPanel } from '@/components/orgs/branding-panel';
import { OrgColorForm } from '@/components/orgs/org-color-form';
import { PublicPageLink } from '@/components/orgs/public-page-link';
import { HandoverPackButton } from '@/components/orgs/handover-pack-button';
import { useOrgDetail } from '@/features/orgs/use-orgs';
import { canManageOrgColors, canManageOrgProfile } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';
import { SkeletonList } from '@/components/ui/skeleton-list';

/**
 * One settings section. Five of these stacked with nothing but a gap between
 * them read as one undifferentiated form; the rule and the description line
 * give each a start, a subject and a boundary.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {description && <p className="max-w-prose text-sm text-foreground-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function OrganizationTab({ orgId, role }: { orgId: string; role: MembershipRole }) {
  const org = useOrgDetail(orgId);

  if (org.isPending) return <SkeletonList rows={3} rowClassName="h-24" className="gap-8" label="Loading organization details" />;
  if (org.isError || !org.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load organization details.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Profile" description="Name, description, socials and advisors — shown on your public club page.">
        <OrganizationProfileForm orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </Section>

      <Section title="Branding" description="Your logo appears in the sidebar and on your public page; the banner heads that page.">
        <BrandingPanel orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </Section>

      <Section title="Colors" description="Your primary color replaces the platform violet everywhere in this organization.">
        <OrgColorForm orgId={orgId} org={org.data} canManage={canManageOrgColors(role)} />
      </Section>

      <Section title="Public page" description="The page anyone can open without an account.">
        <PublicPageLink slug={org.data.slug} />
      </Section>

      <Section
        title="Handover pack"
        description="A PDF export of your committee roster, recent meeting minutes, asset inventory, key files, and upcoming events — for committee rotation."
      >
        <HandoverPackButton orgId={orgId} orgSlug={org.data.slug} />
      </Section>
    </div>
  );
}
