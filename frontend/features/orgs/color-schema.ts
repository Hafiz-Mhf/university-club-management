import { z } from 'zod';

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

// Mirrors backend UpdateOrganizationSettingsDto's @Matches pattern exactly.
export const orgColorSchema = z.object({
  primaryColor: z.string().regex(HEX_COLOR, 'Must be a hex color like #2563eb'),
  secondaryColor: z.string().regex(HEX_COLOR, 'Must be a hex color like #1e293b'),
});

export type OrgColorFormValues = z.infer<typeof orgColorSchema>;
