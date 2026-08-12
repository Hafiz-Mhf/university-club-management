'use client';

import { EventPickerList } from '@/components/events/event-picker-list';
import { MyCertificatesView } from '@/components/participation/my-certificates-view';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

/** Event picker for issuing certificates — committee only. */
function CertificateEventPicker() {
  const { org } = useOrg();
  return (
    <EventPickerList
      orgId={org.id}
      title="Certificates"
      hrefFor={(event) => `/${org.slug}/certificates/${event.id}`}
      secondaryFor={(event) =>
        event.status === 'COMPLETED'
          ? `${event.approvedCount} attendees eligible`
          : 'certificates open once the event is completed'
      }
      emptyMessage="No events to issue certificates for yet. They appear here once an event is published."
    />
  );
}

// Split so each branch owns its own queries — see attendance/page.tsx.
export default function CertificatesPage() {
  const { membership } = useOrg();
  return isCommittee(membership.role) ? <CertificateEventPicker /> : <MyCertificatesView />;
}
