import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const REGISTRATION_ID = '6f1c9d2e-4a5b-4c3d-8e7f-0a1b2c3d4e5f';
const USER_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

let registrationsState: { data: unknown; isError: boolean };
let membersState: { data: unknown; isError: boolean };

vi.mock('@/features/attendance/use-attendance', () => ({
  useAttendanceList: () => ({
    data: [
      { id: 'att1', registrationId: REGISTRATION_ID, status: 'PRESENT', createdAt: new Date().toISOString() },
    ],
    isPending: false,
    isError: false,
  }),
  useMarkAbsent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/registrations/use-registrations', () => ({
  useRegistrations: () => registrationsState,
}));

vi.mock('@/features/members/use-members', () => ({
  useMembers: () => membersState,
}));

import { AttendanceRoster } from '@/components/attendance/attendance-roster';

describe('AttendanceRoster', () => {
  beforeEach(() => {
    registrationsState = {
      data: [{ id: REGISTRATION_ID, userId: USER_ID }],
      isError: false,
    };
    membersState = {
      data: [{ userId: USER_ID, user: { fullName: 'Alex Tan' } }],
      isError: false,
    };
  });

  it('shows the participant name when both lookups succeed', () => {
    render(<AttendanceRoster orgId="org1" eventId="ev1" />);
    expect(screen.getByText('Alex Tan')).toBeInTheDocument();
  });

  it('never renders a raw id when the lookups are 403-gated', () => {
    // A VOLUNTEER can open this roster but is not allowed to call
    // GET /registrations or GET /members, so both come back as errors.
    registrationsState = { data: undefined, isError: true };
    membersState = { data: undefined, isError: true };

    render(<AttendanceRoster orgId="org1" eventId="ev1" />);

    expect(screen.queryByText(REGISTRATION_ID)).not.toBeInTheDocument();
    expect(screen.queryByText(USER_ID)).not.toBeInTheDocument();
    expect(screen.getByText('Participant')).toBeInTheDocument();
  });
});
