import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Organization } from '@/types/api';

const org: Organization & { logoUrl: string | null } = {
  id: 'org1',
  name: 'Tech Innovators Society',
  slug: 'tech-innovators',
  description: null,
  primaryColor: null,
  secondaryColor: null,
  logoUrl: null,
  bannerUrl: null,
  socialLinks: null,
  advisors: null,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/features/orgs/org-provider', () => ({
  useOrg: () => ({ org }),
}));

vi.mock('@/features/orgs/use-orgs', () => ({
  useOrgs: () => ({ data: [org] }),
}));

import { OrgSwitcher } from '@/components/shell/org-switcher';

/**
 * Base UI's AvatarImage only mounts the <img> once the browser reports the
 * source as loaded, and jsdom never actually fetches. This stub resolves every
 * load so the loaded branch is reachable in tests.
 */
class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('OrgSwitcher', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', LoadedImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    org.logoUrl = null;
  });

  it('shows the uploaded logo instead of initials', async () => {
    org.logoUrl = 'https://minio.test/org1/logo.png?sig=abc';
    render(<OrgSwitcher />);
    const logo = await screen.findByRole('img', { name: /tech innovators society/i });
    expect(logo).toHaveAttribute('src', org.logoUrl);
  });

  it('falls back to initials when no logo is uploaded', () => {
    render(<OrgSwitcher />);
    expect(screen.getByText('TI')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
