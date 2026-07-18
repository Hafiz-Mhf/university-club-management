import { z } from 'zod';

// Mirrors backend AddMemberDto — email + role required, profile fields
// optional strings (backend does the real validation; this just keeps
// obvious errors off the wire).
export const addMemberSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum([
    'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
    'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
  ]),
  studentId: z.string().optional(),
  faculty: z.string().optional(),
  programme: z.string().optional(),
  intake: z.string().optional(),
  phone: z.string().optional(),
});

export type AddMemberFormInput = z.infer<typeof addMemberSchema>;

// Mirrors backend UpdateMemberDto exactly — no role, no email. Status is
// optional at the schema level (UpdateMemberDto's status is optional too);
// the edit page always sends one because its form always seeds a value.
export const editMemberSchema = z.object({
  status: z.enum(['ACTIVE', 'ALUMNI']).optional(),
  studentId: z.string().optional(),
  faculty: z.string().optional(),
  programme: z.string().optional(),
  intake: z.string().optional(),
  phone: z.string().optional(),
});

export type EditMemberFormInput = z.infer<typeof editMemberSchema>;
