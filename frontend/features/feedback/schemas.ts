import { z } from 'zod';

// Mirrors backend SubmitFeedbackDto — the backend re-validates everything;
// these checks exist so obvious errors never leave the client.
export const feedbackFormSchema = z.object({
  npsScore: z.number().int().min(0).max(10),
  contentRating: z.number().int().min(1).max(5),
  organizationRating: z.number().int().min(1).max(5),
  venueRating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export type FeedbackFormInput = z.infer<typeof feedbackFormSchema>;
