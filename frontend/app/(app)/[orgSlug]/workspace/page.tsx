'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FileList } from '@/components/files/file-list';
import { UploadFileDialog } from '@/components/files/upload-file-dialog';
import { AssetList } from '@/components/assets/asset-list';
import { AssetDialog } from '@/components/assets/asset-dialog';
import { MinutesList } from '@/components/minutes/minutes-list';
import { TabStrip } from '@/components/ui/tab-strip';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
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
        {tab === 'minutes' && committee && (
          <Link
            href={`/${org.slug}/workspace/minutes/new`}
            className={buttonVariants({ size: 'sm' })}
          >
            <Plus className="size-3.5" />
            New minutes
          </Link>
        )}
        {tab === 'assets' && committee && (
          <Button size="sm" onClick={() => setAssetDialog({ mode: 'create' })}>
            <Plus className="size-3.5" />
            Add asset
          </Button>
        )}
      </div>

      <TabStrip label="Workspace sections" tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'files' && <FileList orgId={org.id} canManage={committee} />}
      {tab === 'minutes' && (
        <MinutesList orgId={org.id} orgSlug={org.slug} canManage={committee} />
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
