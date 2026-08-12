'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { chartDate } from '@/features/analytics/format';

export interface LineDatum {
  date: string;
  value: number | null;
}

export function SingleSeriesLineChart({
  data,
  label,
  color = 'var(--chart-1)',
  domain,
}: {
  data: LineDatum[];
  label: string;
  color?: string;
  /** Pin the axis for bounded metrics (NPS is 0–10, not 0–12). */
  domain?: [number, number];
}) {
  const config: ChartConfig = { value: { label, color } };
  const points = data.filter((d) => d.value !== null).length;

  return (
    <div className="flex flex-col gap-1">
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={chartDate}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={40}
            allowDecimals={false}
            {...(domain ? { domain } : {})}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => (typeof label === 'string' ? chartDate(label) : label)}
              />
            }
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-value)' }}
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>
      {/* A grid holding two lonely dots looks broken rather than sparse — say so. */}
      {points > 0 && points < 3 && (
        <p className="text-xs text-foreground-muted">
          {points === 1 ? 'One data point' : 'Two data points'} in this range — too few to read as a
          trend.
        </p>
      )}
      {points === 0 && (
        <p className="text-xs text-foreground-muted">No data in this range yet.</p>
      )}
    </div>
  );
}
