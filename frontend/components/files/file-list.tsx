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
import { FileCategoryBadge } from '@/components/files/file-category-badge';
import { useDeleteFile, useDownloadFile, useFiles } from '@/features/files/use-files';
import { resolveUploaderName } from '@/features/files/resolve-uploader-name';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import type { FileCategory } from '@/types/api';

const CATEGORIES: FileCategory[] = ['SOP', 'REPORT', 'FINANCIAL', 'MEETING', 'OTHER'];

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function FileList({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [category, setCategory] = useState<FileCategory | undefined>(undefined);
  const files = useFiles(orgId, category);
  const members = useMembers(orgId, {});
  const download = useDownloadFile(orgId);
  const remove = useDeleteFile(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <select
        value={category ?? ''}
        onChange={(e) => setCategory(e.target.value ? (e.target.value as FileCategory) : undefined)}
        aria-label="Filter by category"
        className="h-9 w-fit rounded-md border border-input bg-surface px-2.5 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {files.isPending ? null : files.isError ? (
        <p className="text-sm text-foreground-muted">Couldn&apos;t load files.</p>
      ) : files.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">No files yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {files.data.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span>{f.title}</span>
                <FileCategoryBadge category={f.category} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground-subtle">
                  {/* GET /members is VIEW_MEMBERS-gated (committee-only) but
                      this list is visible to any org member — a 403 here is
                      an expected authorization boundary, not a missing row,
                      so it must not fall through to resolveUploaderName's
                      raw-id fallback (that would leak an internal UUID). */}
                  {members.isError
                    ? 'Committee member'
                    : resolveUploaderName(f.uploadedByUserId, members.data ?? [])}{' '}
                  · {formatFileSize(f.fileSizeBytes)} · {relativeTime(f.createdAt)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => {
                    download.mutate(f.id, {
                      onSuccess: ({ downloadUrl }) => window.open(downloadUrl, '_blank', 'noreferrer'),
                    });
                  }}
                >
                  Download
                </Button>
                {canManage && (
                  <Button variant="destructive" size="sm" onClick={() => setRemoving(f.id)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove file?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. You can re-upload it later.
            </DialogDescription>
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
