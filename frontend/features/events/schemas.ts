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
    requireFeedbackForCertificate: z.boolean().default(false),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start',
    path: ['endAt'],
  })
  .refine((v) => !v.capacity || (Number.isInteger(Number(v.capacity)) && Number(v.capacity) >= 1), {
    message: 'Capacity must be a positive whole number',
    path: ['capacity'],
  });

// Zod's .default() splits the schema's input/output types: raw form values
// may omit requireFeedbackForCertificate (input), parsed values never do
// (output). RHF needs both — useForm<EventFormValues, unknown, EventFormInput>.
export type EventFormValues = z.input<typeof eventFormSchema>;
export type EventFormInput = z.output<typeof eventFormSchema>;
