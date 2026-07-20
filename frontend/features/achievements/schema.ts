import { z } from 'zod';

// Mirrors backend CreateAchievementDto/UpdateAchievementDto. year has no
// min/max bound on either side — the backend DTO only checks @IsInt, so
// the frontend doesn't invent a stricter rule than the backend enforces.
export const achievementFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  year: z.string().refine((v) => Number.isInteger(Number(v)) && v.trim() !== '', 'Year must be a whole number'),
});

export type AchievementFormValues = z.infer<typeof achievementFormSchema>;
