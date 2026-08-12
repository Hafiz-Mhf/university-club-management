import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MyMembership } from '@/types/api';

const membership: MyMembership = {
  id: 'm1',
  userId: 'u1',
  organizationId: 'org1',
  role: 'PRESIDENT',
  status: 'ACTIVE',
  studentId: 'A21CS0101',
  faculty: 'Computing',
  programme: 'BSc Computer Science',
  intake: '2021/2022',
  phone: '+60123400101',
  committeeHistory: null,
  joinedAt: '2025-08-01T00:00:00.000Z',
  user: { id: 'u1', fullName: 'Nur Aisyah Rahman', email: 'aisyah@demo.test' },
};

let current: MyMembership = membership;

vi.mock('@/features/orgs/org-provider', () => ({
  useOrg: () => ({
    org: { id: 'org1', slug: 'tech-innovators', name: 'Tech Innovators Society' },
    membership: current,
  }),
}));

import { AccountIdentity } from '@/components/account/account-identity';

describe('AccountIdentity', () => {
  it('answers "who am I signed in as" without any interaction', () => {
    current = membership;
    render(<AccountIdentity />);
    expect(screen.getByText('Nur Aisyah Rahman')).toBeInTheDocument();
    expect(screen.getByText('aisyah@demo.test')).toBeInTheDocument();
    expect(screen.getByText('President')).toBeInTheDocument();
    expect(screen.getByText(/Tech Innovators Society · joined August 2025/)).toBeInTheDocument();
  });

  it('lists the org-specific details the committee holds', () => {
    current = membership;
    render(<AccountIdentity />);
    expect(screen.getByText('A21CS0101')).toBeInTheDocument();
    expect(screen.getByText('Computing')).toBeInTheDocument();
    expect(screen.getByText('BSc Computer Science')).toBeInTheDocument();
  });

  it('omits detail rows the member never filled in rather than printing blanks', () => {
    current = { ...membership, studentId: null, faculty: null, programme: null, intake: null, phone: null };
    render(<AccountIdentity />);
    expect(screen.queryByText('Student ID')).toBeNull();
    expect(screen.queryByText('Faculty')).toBeNull();
    // Identity itself still renders — the header is not conditional.
    expect(screen.getByText('Nur Aisyah Rahman')).toBeInTheDocument();
  });
});
