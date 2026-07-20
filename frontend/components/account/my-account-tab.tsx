'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConsentHistory } from '@/components/account/consent-history';
import { ExportDataButton } from '@/components/account/export-data-button';
import { DeleteAccountDialog } from '@/components/account/delete-account-dialog';

export function MyAccountTab() {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Consent history</h2>
        <ConsentHistory />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Export your data</h2>
        <p className="text-sm text-foreground-muted">
          Download a copy of everything associated with your account, across every organization.
        </p>
        <ExportDataButton />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Delete account</h2>
        <p className="text-sm text-foreground-muted">
          Permanently anonymize your account. This can&apos;t be undone.
        </p>
        <Button type="button" variant="destructive" className="w-fit" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </section>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
