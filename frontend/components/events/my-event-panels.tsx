'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { MyCertificatePanel } from '@/components/certificates/my-certificate-panel';
import { MyFeedbackPanel } from '@/components/feedback/my-feedback-panel';
import { MyRegistrationPanel } from '@/components/registrations/my-registration-panel';
import { useMyRegistration } from '@/features/registrations/use-registrations';
import { useMyCertificate } from '@/features/certificates/use-certificates';
import { useMyAttendance } from '@/features/attendance/use-attendance';
import { useMyFeedback } from '@/features/feedback/use-feedback';
import type { Event } from '@/types/api';

/**
 * The participant's own three panels for one event, gated on a single loading
 * state. Each panel has its own pending placeholder, so rendering them directly
 * made three separate placeholders resolve one at a time and shift the page
 * under the reader — one gate, one placeholder, one settle.
 *
 * These hooks are the same query keys the children use, so React Query serves
 * both from one cache entry — this adds no extra requests, it only lets the
 * parent know when all of them have settled.
 */
export function MyEventPanels({ orgId, event }: { orgId: string; event: Event }) {
  const registration = useMyRegistration(orgId, event.id);
  const certificate = useMyCertificate(orgId, event.id);
  const attendance = useMyAttendance(orgId, event.id);
  const feedback = useMyFeedback(orgId, event.id);

  const pending =
    registration.isPending || certificate.isPending || attendance.isPending || feedback.isPending;

  // Sized to the action row these panels resolve into (a status badge plus one
  // or two buttons) so the page keeps its height while the queries land.
  if (pending) {
    return (
      <Skeleton role="status" aria-label="Loading your registration" className="h-9 w-64" />
    );
  }

  return (
    <>
      <MyRegistrationPanel orgId={orgId} event={event} />
      <MyCertificatePanel orgId={orgId} eventId={event.id} />
      <MyFeedbackPanel orgId={orgId} event={event} />
    </>
  );
}
