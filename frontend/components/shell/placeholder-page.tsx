import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlaceholderPageProps {
  title: string;
  icon: LucideIcon;
  iconClass?: string;
}

/** Honest map marker for routes whose slice hasn't shipped yet. */
export function PlaceholderPage({ title, icon: Icon, iconClass }: PlaceholderPageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <Icon className={cn('size-5', iconClass ?? 'text-foreground-muted')} />
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-foreground-muted">Coming in a later slice.</p>
    </div>
  );
}
