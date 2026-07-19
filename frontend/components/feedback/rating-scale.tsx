'use client';

import { cn } from '@/lib/utils';

interface RatingScaleProps {
  min: number;
  max: number;
  value: number | undefined;
  onChange: (value: number) => void;
  label: string;
}

export function RatingScale({ min, max, value, onChange, label }: RatingScaleProps) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={cn(
              'flex size-8 items-center justify-center rounded-md border border-border text-sm transition-colors',
              value === n ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
