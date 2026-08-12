'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { chartDate } from '@/features/analytics/format';

export interface RatingsDatum {
  date: string;
  content: number | null;
  organization: number | null;
  venue: number | null;
}

// Fixed 3-series categorical set (content/organization/venue, same 1-5
// scale) — kept as its own component rather than generalizing
// SingleSeriesLineChart to N series, since this is the only multi-series
// chart in this slice (YAGNI).
const config: ChartConfig = {
  content: { label: 'Content', color: 'var(--chart-1)' },
  organization: { label: 'Organization', color: 'var(--chart-2)' },
  venue: { label: 'Venue', color: 'var(--chart-3)' },
};

export function RatingsTrendChart({ data }: { data: RatingsDatum[] }) {
  return (
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
        <YAxis domain={[1, 5]} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => (typeof label === 'string' ? chartDate(label) : label)}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="content"
          type="monotone"
          stroke="var(--color-content)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-content)' }}
          connectNulls={false}
        />
        <Line
          dataKey="organization"
          type="monotone"
          stroke="var(--color-organization)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-organization)' }}
          connectNulls={false}
        />
        <Line
          dataKey="venue"
          type="monotone"
          stroke="var(--color-venue)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-venue)' }}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
