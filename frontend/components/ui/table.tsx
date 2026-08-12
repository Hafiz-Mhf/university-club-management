import { cn } from '@/lib/utils';

/**
 * Minimal table primitives for the committee surfaces, where lists are long
 * enough that a card per row costs a screenful. Numeric and date cells opt into
 * `tabular-nums` via `TableCell numeric`, per design.md's table rules.
 *
 * The wrapper owns horizontal overflow so a wide table scrolls inside itself
 * instead of pushing the page sideways.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/40 data-[selected=true]:bg-primary/5',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-9 px-3 text-left align-middle text-xs font-medium text-foreground-muted whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric,
  ...props
}: React.ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-3 py-2.5 align-middle', numeric && 'tabular-nums', className)}
      {...props}
    />
  );
}
