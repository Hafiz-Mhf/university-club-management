import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Event } from '@/types/api';

let formState: { data: unknown; isPending: boolean; isError: boolean };
const refetch = vi.fn();
const mutate = vi.fn();

vi.mock('@/features/registrations/use-registration-form', () => ({
  useRegistrationForm: () => ({ ...formState, refetch }),
  useUpsertRegistrationForm: () => ({ mutate, isPending: false, error: null }),
}));

import { RegistrationFormEditor } from '@/components/registrations/registration-form-editor';

const event = { id: 'ev1', status: 'DRAFT' } as Event;

describe('RegistrationFormEditor', () => {
  beforeEach(() => {
    refetch.mockClear();
    mutate.mockClear();
    formState = { data: { fields: [] }, isPending: false, isError: false };
  });

  it('renders the empty-form message when the event genuinely has no form', () => {
    render(<RegistrationFormEditor orgId="org1" event={event} />);
    expect(screen.getByText(/no custom form/i)).toBeInTheDocument();
  });

  it('shows an error instead of an empty form when the fetch fails', () => {
    // The saved form may well have fields; rendering "no custom form" here
    // invites a Save that would PUT an empty field list over the real one.
    formState = { data: undefined, isPending: false, isError: true };
    render(<RegistrationFormEditor orgId="org1" event={event} />);

    expect(screen.queryByText(/no custom form/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
