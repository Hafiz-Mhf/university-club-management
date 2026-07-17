import { z } from 'zod';

// Mirrors backend CreateEventDto/UpdateEventDto. The backend re-validates
// everything; these checks exist so obvious errors never leave the client.
export const eventFormSchema = z
  .object({
    title: z.string().min(2, 'Title must be at least 2 characters'),
    description: z.string().optional(),
    venue: z.string().optional(),
    startAt: z.string().min(1, 'Start date/time is required'),
    endAt: z.string().min(1, 'End date/time is required'),
    capacity: z.string().optional(),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start',
    path: ['endAt'],
  })
  .refine((v) => !v.capacity || (Number.isInteger(Number(v.capacity)) && Number(v.capacity) >= 1), {
    message: 'Capacity must be a positive whole number',
    path: ['capacity'],
  });

export type EventFormInput = z.infer<typeof eventFormSchema>;
