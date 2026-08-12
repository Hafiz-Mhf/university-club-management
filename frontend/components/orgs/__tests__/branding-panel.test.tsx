import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Organization } from '@/types/api';

const uploadLogo = vi.fn();

vi.mock('@/features/orgs/use-orgs', () => ({
  useUploadLogo: () => ({ mutate: uploadLogo, isPending: false, error: null }),
  useDeleteLogo: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUploadBanner: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteBanner: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

import { BrandingPanel } from '@/components/orgs/branding-panel';

const org = {
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
} as Organization;

const png = () => new File(['x'], 'logo.png', { type: 'image/png' });

describe('BrandingPanel', () => {
  beforeEach(() => {
    uploadLogo.mockClear();
    // jsdom has no object-URL implementation.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('states the accepted formats and size up front', () => {
    render(<BrandingPanel orgId="org1" org={org} canManage />);
    expect(screen.getAllByText('PNG, JPEG or WebP · up to 2MB')).toHaveLength(2);
  });

  it('names the picked file and holds it until the user commits', async () => {
    render(<BrandingPanel orgId="org1" org={org} canManage />);
    await userEvent.upload(screen.getByLabelText('Logo file'), png());

    expect(screen.getByText('logo.png — not saved yet')).toBeInTheDocument();
    expect(uploadLogo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Save logo/ }));
    expect(uploadLogo).toHaveBeenCalledTimes(1);
    expect(uploadLogo.mock.calls[0][0]).toBeInstanceOf(FormData);
  });

  it('rejects a bad file at pick time, not after upload', async () => {
    render(<BrandingPanel orgId="org1" org={org} canManage />);
    const gif = new File(['x'], 'nope.gif', { type: 'image/gif' });
    // The accept attribute filters the OS dialog, but a drag-drop or a browser
    // that ignores it still reaches onChange — that path must reject too.
    await userEvent.upload(screen.getByLabelText('Logo file'), gif, { applyAccept: false });

    expect(screen.getByRole('alert')).toHaveTextContent('Only PNG, JPEG, or WebP images are accepted');
    expect(screen.queryByRole('button', { name: /Save logo/ })).toBeNull();
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it('lets the user back out of a pick', async () => {
    render(<BrandingPanel orgId="org1" org={org} canManage />);
    await userEvent.upload(screen.getByLabelText('Logo file'), png());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('logo.png — not saved yet')).toBeNull();
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it('shows read-only frames without any upload control for non-managers', () => {
    render(<BrandingPanel orgId="org1" org={{ ...org, logoUrl: 'https://x/logo.png' }} canManage={false} />);
    expect(screen.getByAltText('Logo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Logo file')).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose/ })).toBeNull();
  });
});
