'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/files/file-list';
import { UploadFileDialog } from '@/components/files/upload-file-dialog';
import { AssetList } from '@/components/assets/asset-list';
import { AssetDialog } from '@/components/assets/asset-dialog';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';
import type { Asset } from '@/types/api';

type Tab = 'files' | 'minutes' | 'assets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'assets', label: 'Assets' },
];

type AssetDialogState = { mode: 'create' } | { mode: 'edit'; asset: Asset } | null;

export default function WorkspacePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('files');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [assetDialog, setAssetDialog] = useState<AssetDialogState>(null);
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Workspace</h1>
        {tab === 'files' && committee && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="size-3.5" />
            Upload file
          </Button>
        )}
        {tab === 'assets' && committee && (
          <Button size="sm" onClick={() => setAssetDialog({ mode: 'create' })}>
            <Plus className="size-3.5" />
            Add asset
          </Button>
        )}
      </div>

      <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t.id)}
            className={cn(tab === t.id && 'bg-primary/10 text-primary')}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'files' && <FileList orgId={org.id} canManage={committee} />}
      {tab === 'minutes' && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          Coming in a later sub-slice.
        </p>
      )}
      {tab === 'assets' && (
        <AssetList
          orgId={org.id}
          canManage={committee}
          onEdit={(asset) => setAssetDialog({ mode: 'edit', asset })}
        />
      )}

      <UploadFileDialog orgId={org.id} open={uploadOpen} onOpenChange={setUploadOpen} />
      {assetDialog && (
        <AssetDialog
          orgId={org.id}
          asset={assetDialog.mode === 'edit' ? assetDialog.asset : undefined}
          onClose={() => setAssetDialog(null)}
        />
      )}
    </main>
  );
}
