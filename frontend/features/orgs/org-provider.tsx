'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMyMembership, useOrgs } from '@/features/orgs/use-orgs';
import { meetsBrandContrast } from '@/features/orgs/contrast';
import type { MyMembership, Organization } from '@/types/api';

interface OrgContextValue {
  org: Organization;
  membership: MyMembership;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg must be used inside OrgProvider');
  return value;
}

function activeTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ orgSlug: string }>();
  const orgs = useOrgs();
  const [theme, setTheme] = useState<'light' | 'dark'>(activeTheme);

  const org = useMemo(
    () => orgs.data?.find((o) => o.slug === params.orgSlug),
    [orgs.data, params.orgSlug],
  );
  const membership = useMyMembership(org?.id);

  // Re-evaluate the brand-contrast guard when the theme flips.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(activeTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Unknown slug: send the user somewhere real — their first org, or welcome.
  useEffect(() => {
    if (orgs.data && !org) {
      router.replace(orgs.data.length > 0 ? `/${orgs.data[0].slug}` : '/welcome');
    }
  }, [orgs.data, org, router]);

  const brandStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (org?.primaryColor && meetsBrandContrast(org.primaryColor, theme)) {
      style['--primary'] = org.primaryColor;
    }
    if (org?.secondaryColor) {
      style['--brand-secondary'] = org.secondaryColor;
    }
    return style;
  }, [org?.primaryColor, org?.secondaryColor, theme]);

  if (!org || !membership.data) {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-foreground-subtle" aria-label="Loading" />
      </div>
    );
  }

  return (
    <OrgContext.Provider value={{ org, membership: membership.data }}>
      <div data-org-theme className="flex min-h-dvh flex-1 flex-col" style={brandStyle}>
        {children}
      </div>
    </OrgContext.Provider>
  );
}
