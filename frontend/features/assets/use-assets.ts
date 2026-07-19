'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Asset, AssetCondition } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/assets`;
}

export function useAssets(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'assets'],
    queryFn: () => api<Asset[]>(base(orgId)),
  });
}

function useInvalidateAssets(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'assets'] });
  };
}

export interface AssetInput {
  name: string;
  quantity: number;
  condition?: AssetCondition;
  location?: string;
  notes?: string;
}

export function useCreateAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: (input: AssetInput) => api<Asset>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: ({ assetId, input }: { assetId: string; input: AssetInput }) =>
      api<Asset>(`${base(orgId)}/${assetId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: (assetId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${assetId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
