import { z } from 'zod';

// Mirrors backend CreateAssetDto/UpdateAssetDto. The backend re-validates
// everything; these checks exist so obvious errors never leave the client.
export const assetFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  quantity: z.string().refine(
    (v) => Number.isInteger(Number(v)) && Number(v) >= 1,
    'Quantity must be a positive whole number',
  ),
  condition: z.enum(['GOOD', 'DAMAGED', 'LOST']),
  location: z.string().optional(),
  notes: z.string().optional(),
});

export type AssetFormValues = z.infer<typeof assetFormSchema>;
