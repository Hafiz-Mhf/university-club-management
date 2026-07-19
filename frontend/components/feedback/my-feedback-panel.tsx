'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RatingScale } from '@/components/feedback/rating-scale';
import { useMyAttendance } from '@/features/attendance/use-attendance';
import { useMyFeedback, useSubmitFeedback } from '@/features/feedback/use-feedback';
import { resolveFeedbackPanelState } from '@/features/feedback/panel-state';
import { feedbackFormSchema, type FeedbackFormInput } from '@/features/feedback/schemas';
import { ApiError } from '@/lib/api';
import type { Event } from '@/types/api';

export function MyFeedbackPanel({ orgId, event }: { orgId: string; event: Event }) {
  const attendance = useMyAttendance(orgId, event.id);
  const feedback = useMyFeedback(orgId, event.id);

  if (attendance.isPending || feedback.isPending) return null;

  const state = resolveFeedbackPanelState(attendance.data?.status, feedback.data, event, new Date());

  if (state === 'hidden') return null;

  if (state === 'window-closed') {
    return (
      <p className="text-sm text-foreground-muted">The feedback window for this event has closed.</p>
    );
  }

  if (state === 'recap' && feedback.data) {
    const f = feedback.data;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">Your feedback</p>
        <p className="text-foreground-muted">
          NPS {f.npsScore}/10 · Content {f.contentRating}/5 · Organization {f.organizationRating}/5 ·{' '}
          Venue {f.venueRating}/5
        </p>
        {f.comment && <p className="text-foreground-muted">&quot;{f.comment}&quot;</p>}
      </div>
    );
  }

  return <FeedbackForm orgId={orgId} eventId={event.id} />;
}

function FeedbackForm({ orgId, eventId }: { orgId: string; eventId: string }) {
  const submit = useSubmitFeedback(orgId, eventId);
  const form = useForm<FeedbackFormInput>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: { comment: '' },
  });

  const topError =
    submit.error instanceof ApiError
      ? submit.error.message
      : submit.error
        ? 'Something went wrong — please try again'
        : null;

  return (
    <form
      onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      className="flex flex-col gap-4 rounded-lg border border-border p-3"
      noValidate
    >
      <p className="font-medium">How was this event?</p>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}
      <Controller
        control={form.control}
        name="npsScore"
        render={({ field }) => (
          <RatingScale
            min={0}
            max={10}
            value={field.value}
            onChange={field.onChange}
            label="How likely are you to recommend this event? (0-10)"
          />
        )}
      />
      <Controller
        control={form.control}
        name="contentRating"
        render={({ field }) => (
          <RatingScale min={1} max={5} value={field.value} onChange={field.onChange} label="Content (1-5)" />
        )}
      />
      <Controller
        control={form.control}
        name="organizationRating"
        render={({ field }) => (
          <RatingScale
            min={1}
            max={5}
            value={field.value}
            onChange={field.onChange}
            label="Organization (1-5)"
          />
        )}
      />
      <Controller
        control={form.control}
        name="venueRating"
        render={({ field }) => (
          <RatingScale min={1} max={5} value={field.value} onChange={field.onChange} label="Venue (1-5)" />
        )}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comment">Comment (optional)</Label>
        <Textarea id="comment" rows={3} {...form.register('comment')} />
      </div>
      <div>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending && <Loader2 className="size-4 animate-spin" />}
          Submit feedback
        </Button>
      </div>
    </form>
  );
}
