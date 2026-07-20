'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteAccount } from '@/features/pdpa/use-pdpa';
import { DELETE_CONFIRM_TEXT, isDeleteConfirmed } from '@/features/pdpa/confirm-text';
import { useAuthStore } from '@/features/auth/auth-store';
import { ApiError } from '@/lib/api';

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  const deleteAccount = useDeleteAccount();
  const [confirmText, setConfirmText] = useState('');

  const close = (next: boolean) => {
    if (!next) setConfirmText('');
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently anonymizes your account and signs you out of every organization.
            It can&apos;t be undone. Type <strong>{DELETE_CONFIRM_TEXT}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          aria-label="Confirmation text"
        />
        {deleteAccount.error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {deleteAccount.error instanceof ApiError ? deleteAccount.error.message : 'Something went wrong'}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!isDeleteConfirmed(confirmText) || deleteAccount.isPending}
            onClick={() => {
              deleteAccount.mutate(undefined, {
                onSuccess: () => {
                  clearSession();
                  router.replace('/login');
                },
              });
            }}
          >
            {deleteAccount.isPending && <Loader2 className="size-4 animate-spin" />}
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
