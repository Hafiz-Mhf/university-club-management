'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { BarDatum } from '@/features/analytics/shape';

const config: ChartConfig = {
  value: { label: 'Count', color: 'var(--chart-1)' },
};

export function HorizontalBarChart({ data }: { data: BarDatum[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} maxBarSize={20} />
      </BarChart>
    </ChartContainer>
  );
}
