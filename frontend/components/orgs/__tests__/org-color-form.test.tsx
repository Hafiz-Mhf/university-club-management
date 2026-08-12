import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Organization } from '@/types/api';

const mutate = vi.fn();

vi.mock('@/features/orgs/use-orgs', () => ({
  useUpdateOrgSettings: () => ({ mutate, isPending: false, isSuccess: false, error: null }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { OrgColorForm } from '@/components/orgs/org-color-form';

const org = {
  id: 'org1',
  name: 'Tech Innovators Society',
  slug: 'tech-innovators',
  description: null,
  primaryColor: '#6E56CF',
  secondaryColor: '#5B8DEF',
  socialLinks: null,
  advisors: null,
} as Organization;

describe('OrgColorForm', () => {
  beforeEach(() => mutate.mockClear());

  it('offers a picker as well as the hex field', () => {
    render(<OrgColorForm orgId="org1" org={org} canManage />);
    expect(screen.getByLabelText('Primary color picker')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary color')).toHaveValue('#6E56CF');
  });

  it('stays quiet when the brand color works in both themes', () => {
    render(<OrgColorForm orgId="org1" org={org} canManage />);
    expect(screen.queryByText(/Too low-contrast/)).toBeNull();
  });

  it('warns which theme will silently drop the color', async () => {
    // Yellow clears the dark canvas and fails the light one, so the provider
    // would keep the default violet in light mode with no other signal.
    render(<OrgColorForm orgId="org1" org={{ ...org, primaryColor: '#FFEE00' }} canManage />);
    expect(await screen.findByText(/Too low-contrast for light mode/)).toBeInTheDocument();
    expect(screen.getByText(/default violet instead/)).toBeInTheDocument();
  });

  it('updates the warning as the hex is edited', async () => {
    render(<OrgColorForm orgId="org1" org={org} canManage />);
    const field = screen.getByLabelText('Primary color');
    await userEvent.clear(field);
    await userEvent.type(field, '#FFEE00');
    expect(await screen.findByText(/Too low-contrast for light mode/)).toBeInTheDocument();
  });

  it('hides the save control and explains why for non-Presidents', () => {
    render(<OrgColorForm orgId="org1" org={org} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Save colors' })).toBeNull();
    expect(screen.getByText(/Only the President/)).toBeInTheDocument();
    expect(screen.getByLabelText('Primary color')).toBeDisabled();
  });
});
