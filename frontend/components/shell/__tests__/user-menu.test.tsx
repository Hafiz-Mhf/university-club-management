import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const logoutMutate = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/robotics-club',
}));

vi.mock('@/features/auth/use-auth', () => ({
  useLogout: () => ({ mutate: logoutMutate, isPending: false }),
}));

vi.mock('@/features/orgs/org-provider', () => ({
  useOrg: () => ({
    org: { id: 'org1', slug: 'robotics-club', name: 'Robotics Club' },
    membership: { id: 'm1', role: 'PRESIDENT', status: 'ACTIVE' },
  }),
}));

import { UserMenu } from '@/components/shell/user-menu';

describe('UserMenu', () => {
  it('shows the account link and sign out without any interaction', () => {
    // The old dropdown hid both behind an unlabelled avatar — the whole point
    // of this block is that a first-time user can see them straight away.
    render(<UserMenu />);
    expect(screen.getByRole('link', { name: /my account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('links to the account tab of settings', () => {
    render(<UserMenu />);
    expect(screen.getByRole('link', { name: /my account/i })).toHaveAttribute(
      'href',
      '/robotics-club/settings?tab=account',
    );
  });

  it('names the current role so the account block is self-explaining', () => {
    render(<UserMenu />);
    expect(screen.getByText('President')).toBeInTheDocument();
  });

  it('signs out on click', async () => {
    render(<UserMenu />);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(logoutMutate).toHaveBeenCalled();
  });
});
