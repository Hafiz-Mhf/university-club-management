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
import { useAchievements, useRemoveAchievement } from '@/features/achievements/use-achievements';
import type { Achievement } from '@/types/api';

export function AchievementsList({
  orgId,
  canManage,
  onEdit,
}: {
  orgId: string;
  canManage: boolean;
  onEdit: (achievement: Achievement) => void;
}) {
  const achievements = useAchievements(orgId);
  const remove = useRemoveAchievement(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (achievements.isPending) return null;
  if (achievements.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load achievements.</p>;
  }
  if (achievements.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No achievements yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {achievements.data.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {a.title} <span className="text-foreground-muted">— {a.year}</span>
            </p>
            <p className="text-foreground-muted">{a.description}</p>
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setRemoving(a.id)}>
                Remove
              </Button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove achievement?</DialogTitle>
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
