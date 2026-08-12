'use client';

import { EventPickerList } from '@/components/events/event-picker-list';
import { MyFeedbackView } from '@/components/participation/my-feedback-view';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

/** Event picker for feedback summaries — committee only. */
function FeedbackEventPicker() {
  const { org } = useOrg();
  return (
    <EventPickerList
      orgId={org.id}
      title="Feedback"
      hrefFor={(event) => `/${org.slug}/feedback/${event.id}`}
      secondaryFor={(event) => {
        if (event.feedbackCount === 0) {
          return event.status === 'COMPLETED' ? 'no responses yet' : 'opens after the event';
        }
        const of = event.approvedCount > 0 ? ` of ${event.approvedCount}` : '';
        return `${event.feedbackCount}${of} responded`;
      }}
      emptyMessage="No events to collect feedback on yet. Feedback opens to attendees once an event has run."
    />
  );
}

// Split so each branch owns its own queries — see attendance/page.tsx.
export default function FeedbackPage() {
  const { membership } = useOrg();
  return isCommittee(membership.role) ? <FeedbackEventPicker /> : <MyFeedbackView />;
}
