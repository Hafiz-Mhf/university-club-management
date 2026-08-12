'use client';

import { EventPickerList } from '@/components/events/event-picker-list';
import { MyAttendanceView } from '@/components/participation/my-attendance-view';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageAttendance } from '@/features/orgs/roles';

/** Event picker for the scanner — committee and volunteers only. */
function ScannerEventPicker() {
  const { org } = useOrg();
  return (
    <EventPickerList
      orgId={org.id}
      title="Attendance"
      hrefFor={(event) => `/${org.slug}/attendance/${event.id}`}
      secondaryFor={(event) =>
        event.approvedCount === 0
          ? 'nobody registered yet'
          : `${event.approvedCount} to check in`
      }
      emptyMessage="No events to check in for yet. Publish an event and its roster shows up here."
    />
  );
}

// Split so each branch owns its own queries — a participant never fires the
// org-wide events list, and a scanner never fires the participation read.
export default function AttendancePage() {
  const { membership } = useOrg();
  return canManageAttendance(membership.role) ? <ScannerEventPicker /> : <MyAttendanceView />;
}
