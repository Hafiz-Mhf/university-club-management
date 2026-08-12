import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SkeletonListProps {
  /** How many placeholder rows to draw. Match the typical result count, not the max. */
  rows?: number;
  /** Tailwind height of one row — size it to the real row it stands in for. */
  rowClassName?: string;
  className?: string;
  /** Announced to screen readers while content loads. */
  label?: string;
}

/**
 * The repeated "list is loading" placeholder. Every list surface in the app
 * shows one of these instead of collapsing to blank, so the page keeps its
 * shape and doesn't shift content under the reader when data lands.
 */
export function SkeletonList({
  rows = 3,
  rowClassName = 'h-14',
  className,
  label = 'Loading…',
}: SkeletonListProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn('flex flex-col gap-2', className)}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('rounded-lg', rowClassName)} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
