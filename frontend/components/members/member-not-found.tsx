import { UserX } from 'lucide-react';

/**
 * Deliberately vague, same as EventNotFound — a foreign-org id, a removed
 * member, and a genuinely bad URL must all look identical.
 */
export function MemberNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <UserX className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Member not found</h1>
      <p className="text-sm text-foreground-muted">
        They may have been removed, or you don&apos;t have access.
      </p>
    </div>
  );
}
