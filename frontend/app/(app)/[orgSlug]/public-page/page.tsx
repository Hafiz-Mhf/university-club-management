'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GalleryUploadForm } from '@/components/gallery/gallery-upload-form';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

type Tab = 'gallery' | 'achievements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'achievements', label: 'Achievements' },
];

export default function PublicPagePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('gallery');
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Public Page</h1>

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

      {tab === 'gallery' && (
        <div className="flex flex-col gap-4">
          {committee && <GalleryUploadForm orgId={org.id} />}
          <GalleryGrid orgId={org.id} canManage={committee} />
        </div>
      )}
      {tab === 'achievements' && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          Coming in a later sub-slice.
        </p>
      )}
    </main>
  );
}
