import { CalendarX2 } from 'lucide-react';

/**
 * Rendered for a 404 from GET /events/:id. Deliberately vague — a DRAFT
 * event hidden from a non-committee viewer must look identical to a
 * genuinely missing one (backend's no-existence-leak design).
 */
export function EventNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <CalendarX2 className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Event not found</h1>
      <p className="text-sm text-foreground-muted">
        It may have been removed, or you don&apos;t have access to it.
      </p>
    </div>
  );
}
