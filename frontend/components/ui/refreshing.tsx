import { cn } from '@/lib/utils';

interface RefreshingProps {
  /** True while data already on screen is being re-fetched. */
  active: boolean;
  /** Announced to screen readers while the refresh is in flight. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * The "this list is being brought up to date" cue.
 *
 * A skeleton is the right answer for a first load, but wrong for a refresh —
 * tearing loaded rows out and replacing them with grey bars loses the reader's
 * place. So the rows stay, dimmed, and the region reports itself busy until the
 * new data lands. Pair with `isFetching && !isPending` (a first load is the
 * skeleton's job, not this one).
 *
 * Interaction is deliberately left enabled: refreshes are usually quick and
 * freezing the list under the pointer is more disruptive than the stale click.
 */
export function Refreshing({ active, label = 'Refreshing…', className, children }: RefreshingProps) {
  return (
    <div
      aria-busy={active || undefined}
      className={cn(
        'motion-safe:transition-opacity motion-safe:duration-200',
        active && 'opacity-60',
        className,
      )}
    >
      {children}
      {active && (
        <span role="status" className="sr-only">
          {label}
        </span>
      )}
    </div>
  );
}
