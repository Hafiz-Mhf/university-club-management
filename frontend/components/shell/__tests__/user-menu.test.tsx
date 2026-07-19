import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/features/auth/use-auth', () => ({
  useLogout: () => ({ mutate: vi.fn() }),
}));

import { UserMenu } from '@/components/shell/user-menu';

it('opens the menu without throwing and shows the sign out item', async () => {
  render(<UserMenu />);
  await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  expect(await screen.findByText('Sign out')).toBeInTheDocument();
});
