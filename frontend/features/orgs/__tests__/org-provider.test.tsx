import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Organization } from '@/types/api';

const replace = vi.fn();
let params: Record<string, string> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useParams: () => params,
}));

let orgsData: Organization[] | undefined;
let membershipData: { id: string; role: string; status: string } | undefined;

vi.mock('@/features/orgs/use-orgs', () => ({
  useOrgs: () => ({ data: orgsData, isPending: orgsData === undefined }),
  useMyMembership: () => ({ data: membershipData, isPending: membershipData === undefined }),
}));

import { OrgProvider } from '@/features/orgs/org-provider';

const orgA: Organization = {
  id: 'org-a',
  name: 'Alpha Club',
  slug: 'alpha',
  description: null,
  primaryColor: null,
  secondaryColor: null,
};

describe('OrgProvider', () => {
  beforeEach(() => {
    replace.mockClear();
    params = { orgSlug: 'alpha' };
    orgsData = [orgA];
    membershipData = { id: 'm1', role: 'PRESIDENT', status: 'ACTIVE' };
  });

  it('resolves the slug and renders children', () => {
    render(
      <OrgProvider>
        <div>inside</div>
      </OrgProvider>,
    );
    expect(screen.getByText('inside')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('unknown slug with orgs available redirects to the first org', () => {
    params = { orgSlug: 'nope' };
    render(
      <OrgProvider>
        <div>inside</div>
      </OrgProvider>,
    );
    expect(replace).toHaveBeenCalledWith('/alpha');
  });

  it('unknown slug with zero orgs redirects to welcome', () => {
    params = { orgSlug: 'nope' };
    orgsData = [];
    render(
      <OrgProvider>
        <div>inside</div>
      </OrgProvider>,
    );
    expect(replace).toHaveBeenCalledWith('/welcome');
  });

  it('applies a passing org primaryColor as a CSS variable override', () => {
    orgsData = [{ ...orgA, primaryColor: '#0B6E4F', secondaryColor: '#2F7DE1' }];
    const { container } = render(
      <OrgProvider>
        <div>inside</div>
      </OrgProvider>,
    );
    const wrapper = container.querySelector('[data-org-theme]') as HTMLElement;
    expect(wrapper.style.getPropertyValue('--primary')).toBe('#0B6E4F');
    expect(wrapper.style.getPropertyValue('--brand-secondary')).toBe('#2F7DE1');
  });

  it('leaves the platform default when the org color fails contrast', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    orgsData = [{ ...orgA, primaryColor: '#FFFF00', secondaryColor: null }];
    const { container } = render(
      <OrgProvider>
        <div>inside</div>
      </OrgProvider>,
    );
    const wrapper = container.querySelector('[data-org-theme]') as HTMLElement;
    expect(wrapper.style.getPropertyValue('--primary')).toBe('');
  });
});
