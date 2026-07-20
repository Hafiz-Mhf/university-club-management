import { z } from 'zod';

// Mirrors backend UpdateOrganizationDto. socialLinks/advisors are edited as
// arrays here (repeatable form rows) and mapped back to
// Record<string,string> / string[] at submit time — the backend shape is
// free-form, so no fixed platform list or advisor-title field is invented.
export const orgProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120, 'Name must be at most 120 characters'),
  description: z.string().max(2000, 'Description must be at most 2000 characters'),
  socialLinks: z.array(
    z.object({
      key: z.string().min(1, 'Platform is required'),
      value: z.string().min(1, 'URL is required'),
    }),
  ),
  advisors: z.array(
    z.object({
      name: z.string().min(1, 'Name is required'),
    }),
  ),
});

export type OrgProfileFormValues = z.infer<typeof orgProfileSchema>;
