'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AccountIdentity } from '@/components/account/account-identity';
import { ConsentHistory } from '@/components/account/consent-history';
import { ExportDataButton } from '@/components/account/export-data-button';
import { DeleteAccountDialog } from '@/components/account/delete-account-dialog';

export function MyAccountTab() {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <AccountIdentity />

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Consent history</h2>
        <p className="text-sm text-foreground-muted">
          Every consent you&apos;ve given, and which version of the privacy policy it was given
          against.
        </p>
        <ConsentHistory />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Export your data</h2>
        <p className="text-sm text-foreground-muted">
          Download a copy of everything associated with your account, across every organization.
        </p>
        <ExportDataButton />
      </section>

      {/* Irreversible, so it gets its own bounded region instead of sitting at
          the same visual weight as "export a file". */}
      <section className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/5 p-5">
        <h2 className="font-heading text-lg font-semibold text-danger">Danger zone</h2>
        <p className="max-w-prose text-sm text-foreground-muted">
          Deleting permanently anonymizes your account and signs you out of every organization.
          Your past registrations stay in each club&apos;s records without your name attached. This
          can&apos;t be undone.
        </p>
        <Button type="button" variant="destructive" className="w-fit" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </section>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
