'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GalleryUploadForm } from '@/components/gallery/gallery-upload-form';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { AchievementDialog } from '@/components/achievements/achievement-dialog';
import { AchievementsList } from '@/components/achievements/achievements-list';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';
import type { Achievement } from '@/types/api';

type Tab = 'gallery' | 'achievements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'achievements', label: 'Achievements' },
];

type AchievementDialogState = { mode: 'create' } | { mode: 'edit'; achievement: Achievement } | null;

export default function PublicPagePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('gallery');
  const [achievementDialog, setAchievementDialog] = useState<AchievementDialogState>(null);
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Public Page</h1>
        {tab === 'achievements' && committee && (
          <Button size="sm" onClick={() => setAchievementDialog({ mode: 'create' })}>
            <Plus className="size-3.5" />
            Add achievement
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

      {tab === 'gallery' && (
        <div className="flex flex-col gap-4">
          {committee && <GalleryUploadForm orgId={org.id} />}
          <GalleryGrid orgId={org.id} canManage={committee} />
        </div>
      )}
      {tab === 'achievements' && (
        <AchievementsList
          orgId={org.id}
          canManage={committee}
          onEdit={(achievement) => setAchievementDialog({ mode: 'edit', achievement })}
        />
      )}

      {achievementDialog && (
        <AchievementDialog
          orgId={org.id}
          achievement={achievementDialog.mode === 'edit' ? achievementDialog.achievement : undefined}
          onClose={() => setAchievementDialog(null)}
        />
      )}
    </main>
  );
}
