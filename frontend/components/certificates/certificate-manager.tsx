'use client';

import { useMemo, useRef, useState } from 'react';
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
import {
  useCertificateList,
  useRemoveCertificate,
  useUploadCertificate,
} from '@/features/certificates/use-certificates';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import { validateCertificateFile } from '@/features/certificates/validate-file';
import { useAttendanceList } from '@/features/attendance/use-attendance';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import { useRegistrations } from '@/features/registrations/use-registrations';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { api, ApiError } from '@/lib/api';

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function CertificateManager({ orgId, eventId }: { orgId: string; eventId: string }) {
  const certificates = useCertificateList(orgId, eventId);
  const attendance = useAttendanceList(orgId, eventId);
  const registrations = useRegistrations(orgId, eventId);
  const members = useMembers(orgId, {});
  const upload = useUploadCertificate(orgId, eventId);
  const remove = useRemoveCertificate(orgId, eventId);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const certifiedUserIds = useMemo(
    () => new Set((certificates.data ?? []).map((c) => c.userId)),
    [certificates.data],
  );

  const eligibleAttendees = useMemo(
    () =>
      (attendance.data ?? []).filter((a) => {
        if (a.status !== 'PRESENT') return false;
        const registration = (registrations.data ?? []).find((r) => r.id === a.registrationId);
        return registration ? !certifiedUserIds.has(registration.userId) : true;
      }),
    [attendance.data, registrations.data, certifiedUserIds],
  );

  if (certificates.isPending) return null;
  if (certificates.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load certificates.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileInputRef.current?.files?.[0];
          if (!selectedUserId || !file) return;
          const validationError = validateCertificateFile(file);
          if (validationError) {
            setFileError(validationError);
            return;
          }
          setFileError(null);
          setUploadError(null);
          const formData = new FormData();
          formData.set('userId', selectedUserId);
          formData.set('file', file);
          upload.mutate(formData, {
            onSuccess: () => {
              setSelectedUserId('');
              if (fileInputRef.current) fileInputRef.current.value = '';
            },
            onError: (err) => {
              setUploadError(err instanceof ApiError ? err.message : 'Something went wrong');
            },
          });
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          aria-label="Attendee"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="">Select attendee…</option>
          {eligibleAttendees.map((a) => (
            <option key={a.id} value={resolveAttendeeUserId(a, registrations.data ?? [])}>
              {resolveParticipantName(a, registrations.data ?? [], members.data ?? [])}
            </option>
          ))}
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          aria-label="Certificate PDF"
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={upload.isPending || !selectedUserId}>
          {upload.isPending && <Loader2 className="size-4 animate-spin" />}
          Upload
        </Button>
      </form>
      {fileError && (
        <p role="alert" className="text-sm text-danger">{fileError}</p>
      )}
      {uploadError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {uploadError}
        </p>
      )}

      {(certificates.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No certificates issued yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {(certificates.data ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <span>{resolveMemberName(c.userId, members.data ?? [])}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground-subtle">
                  {formatFileSize(c.fileSizeBytes)} · {relativeTime(c.createdAt)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const { downloadUrl } = await api<{ downloadUrl: string }>(
                      `/organizations/${orgId}/events/${eventId}/certificates/${c.id}/download`,
                    );
                    window.open(downloadUrl, '_blank', 'noreferrer');
                  }}
                >
                  Download
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRemoving(c.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove certificate?</DialogTitle>
            <DialogDescription>
              They&apos;ll no longer be able to download it. You can re-upload it later.
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

function resolveAttendeeUserId(
  attendance: { registrationId: string },
  registrations: { id: string; userId: string }[],
): string {
  return registrations.find((r) => r.id === attendance.registrationId)?.userId ?? '';
}
