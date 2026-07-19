'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AssetConditionBadge } from '@/components/assets/asset-condition-badge';
import { useAssets, useDeleteAsset } from '@/features/assets/use-assets';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import type { Asset } from '@/types/api';

export function AssetList({
  orgId,
  canManage,
  onEdit,
}: {
  orgId: string;
  canManage: boolean;
  onEdit: (asset: Asset) => void;
}) {
  const assets = useAssets(orgId);
  const members = useMembers(orgId, {});
  const remove = useDeleteAsset(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (assets.isPending) return null;
  if (assets.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load assets.</p>;
  }
  if (assets.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No assets yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {assets.data.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <span>{a.name}</span>
            <span className="text-xs text-foreground-subtle">×{a.quantity}</span>
            <AssetConditionBadge condition={a.condition} />
            {a.location && <span className="text-xs text-foreground-subtle">{a.location}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground-subtle">
              {/* GET /members is VIEW_MEMBERS-gated (committee-only) but
                  this list is visible to any org member — a 403 here is
                  an expected authorization boundary, not a missing row,
                  so it must not fall through to resolveMemberName's
                  raw-id fallback (that would leak an internal UUID —
                  the exact bug fixed in Slice 9's FileList). */}
              {members.isError
                ? 'Committee member'
                : resolveMemberName(a.createdByUserId, members.data ?? [])}{' '}
              · {relativeTime(a.createdAt)}
            </span>
            {canManage && (
              <>
                <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRemoving(a.id)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove asset?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing, { onSuccess: () => setRemoving(null) });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
