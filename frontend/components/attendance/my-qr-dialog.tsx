'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMyAttendance } from '@/features/attendance/use-attendance';

interface MyQrDialogProps {
  orgId: string;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MyQrDialog({ orgId, eventId, open, onOpenChange }: MyQrDialogProps) {
  const attendance = useMyAttendance(orgId, eventId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attendance.data?.token) {
      QRCode.toDataURL(attendance.data.token).then(setImageUrl);
    } else {
      setImageUrl(null);
    }
  }, [attendance.data?.token]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your check-in code</DialogTitle>
          <DialogDescription>Show this at the door to be scanned in.</DialogDescription>
        </DialogHeader>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image adds nothing here
          <img src={imageUrl} alt="Check-in QR code" className="mx-auto size-56" />
        ) : (
          <p className="text-sm text-foreground-muted">
            {attendance.isPending ? 'Loading…' : 'No check-in code available.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
