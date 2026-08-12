'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabDef<Id extends string> {
  id: Id;
  label: string;
}

interface TabStripProps<Id extends string> {
  /** Names the group for screen readers, e.g. "Settings sections". */
  label: string;
  tabs: TabDef<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}

export function tabId(id: string) {
  return `tab-${id}`;
}

export function tabPanelId(id: string) {
  return `tabpanel-${id}`;
}

/**
 * The app's one tab strip. Settings, Workspace and the rest each grew their own
 * — one of them plain `<button>`s with no roles and no focus ring, so keyboard
 * users could neither see nor hear which panel was selected.
 *
 * Implements the ARIA tabs pattern: roving tabindex, arrow/Home/End keys, and
 * `aria-controls` pointing at a panel the caller labels with `tabPanelId`.
 */
export function TabStrip<Id extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: TabStripProps<Id>) {
  const stripRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.id);
    stripRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.id))}`)?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      className={cn('flex w-fit flex-wrap rounded-md border border-border p-0.5', className)}
      onKeyDown={(e) => {
        const current = tabs.findIndex((t) => t.id === value);
        if (e.key === 'ArrowRight') focusTab(current + 1);
        else if (e.key === 'ArrowLeft') focusTab(current - 1);
        else if (e.key === 'Home') focusTab(0);
        else if (e.key === 'End') focusTab(tabs.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(t.id)}
            // Roving tabindex: one stop for the whole strip, arrows move within it.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex h-11 items-center rounded-sm px-3 text-sm font-medium transition-colors outline-none sm:h-9',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-foreground-muted hover:bg-muted hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
