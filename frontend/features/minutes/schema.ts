import { z } from 'zod';

// Mirrors backend CreateMinutesDto/UpdateMinutesDto. The backend
// re-validates everything; these checks exist so obvious errors never
// leave the client.
export const minutesFormSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  meetingDate: z.string().min(1, 'Meeting date is required'),
  attendeeMembershipIds: z.array(z.string()),
  agendaItems: z.array(
    z.object({
      topic: z.string().min(1, 'Topic is required'),
      notes: z.string().min(1, 'Notes are required'),
    }),
  ),
  actionItems: z.array(
    z.object({
      task: z.string().min(1, 'Task is required'),
      owner: z.string().optional(),
    }),
  ),
});

export type MinutesFormValues = z.infer<typeof minutesFormSchema>;
