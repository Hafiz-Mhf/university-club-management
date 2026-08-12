'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { BarDatum } from '@/features/analytics/shape';

/** Enough room for a bar plus its label; below this Recharts starts skipping ticks. */
const ROW_HEIGHT = 34;
const CHART_PADDING = 24;
const MIN_HEIGHT = 160;
const LABEL_MAX = 22;

function truncate(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

/**
 * Height grows with the number of bars and `interval={0}` forces every tick to
 * render. At a fixed 256px, nine bars got five labels — four bars belonged to
 * nobody, which is fatal for a chart whose whole job is naming people.
 */
export function HorizontalBarChart({
  data,
  color = 'var(--chart-1)',
  valueLabel = 'Count',
}: {
  data: BarDatum[];
  color?: string;
  valueLabel?: string;
}) {
  const config: ChartConfig = { value: { label: valueLabel, color } };
  const height = Math.max(MIN_HEIGHT, data.length * ROW_HEIGHT + CHART_PADDING);

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={132}
          interval={0}
          tickFormatter={truncate}
        />
        {/* Tooltip keeps the untruncated label, so a shortened tick is never a dead end. */}
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} maxBarSize={20} />
      </BarChart>
    </ChartContainer>
  );
}
