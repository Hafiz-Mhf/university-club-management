# Frontend Slice 8 (Analytics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full frontend Analytics dashboard against the backend's already-shipped 7-endpoint `AnalyticsService` — one committee-only `/analytics` page with KPI tiles, line charts, bar charts, and a feedback table.

**Architecture:** Two generic, reusable chart primitives (`HorizontalBarChart`, `SingleSeriesLineChart`) cover 6 of the 7 chart call sites; a dedicated `RatingsTrendChart` handles the one genuinely multi-series case. All read-only `useQuery` hooks, no mutations. Chart color tokens (`--chart-1/2/3`) are pinned to validated hex, reusing three existing domain hues' *light-mode* values unmodified in both themes (their dark-mode variants fail the chart-specific lightness band).

**Tech Stack:** Next.js 18 App Router, TypeScript, TanStack Query, Recharts 3.8 (via `shadcn`'s chart wrapper), Tailwind v4, Vitest.

## Global Constraints

- No backend changes — all 7 endpoints pre-exist (`backend/src/analytics/analytics.controller.ts`), every route `@Roles(...MANAGE_EVENTS)`-gated.
- No CSV/PDF export, no per-chart independent date ranges (one shared 7/30/90-day control), no client-computed derived metrics beyond what the backend returns.
- NPS (0–10 scale) and the three ratings (1–5 scale) are never combined into one chart — different scales, would be a dual-axis chart.
- Feedback section is a table (links to Slice 7's existing `/feedback/[eventId]` page), not a chart — unbounded row count over the org's lifetime.
- Chart color: `chart-1` = `#3F9142` (existing Analytics domain hue), `chart-2` = `#2F7DE1` (existing Registrations domain hue), `chart-3` = `#B8860B` (existing Certificates domain hue) — validated via `dataviz`'s `validate_palette.js` against both the real light surface (`#fafaf8`) and dark surface (`#18171b`); same three hex values pass both, so they are pinned as literal hex in `:root` only, never redefined in `[data-theme="dark"]`.
- No direct unit tests for chart-rendering components or hooks — matches this codebase's established convention (every prior "visual" component, e.g. `MyCertificatePanel`, `FeedbackSummary`, is live-verification-only). Only pure shaping/formatting logic gets a test file.
- Frontend baseline going in: **98/98** (verified via `npm test -- --run` this session, after the account-menu bugfix).

---

### Task 1: Chart infrastructure — shadcn chart install + color tokens + `formatPercent`

**Files:**
- Verify (already created ad-hoc during brainstorming, not yet committed): `frontend/components/ui/chart.tsx`
- Verify (already modified ad-hoc, not yet committed): `frontend/package.json`, `frontend/package-lock.json` (both now carry `recharts: "^3.8.0"`)
- Modify: `frontend/app/globals.css:57-59`
- Create: `frontend/features/analytics/format.ts`
- Test: `frontend/features/analytics/__tests__/format.test.ts`

**Interfaces:**
- Produces: `formatPercent(ratio: number): string` — consumed by Task 9's KPI row for the Attendance Rate tile. `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartLegend`/`ChartLegendContent`/`ChartConfig` from `@/components/ui/chart` — consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Verify the ad-hoc shadcn install is present**

Run: `cd frontend && grep -n "recharts" package.json && ls components/ui/chart.tsx`
Expected: `"recharts": "^3.8.0",` printed, and `components/ui/chart.tsx` exists (both were installed via `npx shadcn@latest add chart` during this slice's brainstorming/design prep — this step only confirms they're still present, no need to re-run the CLI).

- [ ] **Step 2: Pin the chart color tokens**

In `frontend/app/globals.css`, replace lines 57–59 (currently
`--chart-1: var(--domain-events);` / `--chart-2: var(--domain-registrations);` / `--chart-3: var(--domain-attendance);`) with:

```css
  /* Chart-specific tokens (Slice 8 Analytics) — literal hex, not var()
     references to --domain-*, because the validated triple only passes
     the dataviz chart-lightness band in BOTH themes at these exact
     light-mode values; --domain-registrations/--domain-certificates'
     own dark-mode variants (#5b9cf5/#d9a93e) fail that band for chart
     use specifically. Not redefined in [data-theme="dark"] on purpose —
     same three values apply in both themes. */
  --chart-1: #3f9142;
  --chart-2: #2f7de1;
  --chart-3: #b8860b;
```

Leave `--chart-4: var(--domain-certificates);` and `--chart-5: var(--domain-analytics);` (lines 60–61) untouched — unused by this slice, harmless leftover scaffolding.

- [ ] **Step 3: Write the failing test**

Create `frontend/features/analytics/__tests__/format.test.ts`:

```ts
import { expect, it } from 'vitest';
import { formatPercent } from '@/features/analytics/format';

it('rounds a ratio to a whole-number percentage', () => {
  expect(formatPercent(0.78)).toBe('78%');
});

it('handles 0 and 1', () => {
  expect(formatPercent(0)).toBe('0%');
  expect(formatPercent(1)).toBe('100%');
});

it('rounds to the nearest whole percent', () => {
  expect(formatPercent(0.755)).toBe('76%');
  expect(formatPercent(0.754)).toBe('75%');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/analytics/__tests__/format.test.ts`
Expected: FAIL — `Cannot find module '@/features/analytics/format'`

- [ ] **Step 5: Implement `format.ts`**

Create `frontend/features/analytics/format.ts`:

```ts
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/analytics/__tests__/format.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Verify the full suite and build stay clean**

Run: `cd frontend && npm test -- --run`
Expected: PASS, 98 + 3 = 101 tests, 0 failures

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/components/ui/chart.tsx frontend/app/globals.css frontend/features/analytics/format.ts frontend/features/analytics/__tests__/format.test.ts
git commit -m "feat(frontend): chart infrastructure — shadcn chart component, chart color tokens, formatPercent"
```

---

### Task 2: Bar-chart shaping helpers

**Files:**
- Create: `frontend/features/analytics/shape.ts`
- Test: `frontend/features/analytics/__tests__/shape.test.ts`

**Interfaces:**
- Produces: `interface BarDatum { label: string; value: number }`, `toBarData(groups: { value: string | null; count: number }[]): BarDatum[]`, `committeeActivityToBarData(rows: { fullName: string; actionCount: number }[]): BarDatum[]` — both consumed by Task 9's page wiring, and their output shape (`BarDatum[]`) is consumed by Task 4's `HorizontalBarChart`.

- [ ] **Step 1: Write the failing test**

Create `frontend/features/analytics/__tests__/shape.test.ts`:

```ts
import { expect, it } from 'vitest';
import { toBarData, committeeActivityToBarData } from '@/features/analytics/shape';

it('maps a null group value to "Unspecified"', () => {
  const result = toBarData([{ value: null, count: 3 }]);
  expect(result).toEqual([{ label: 'Unspecified', value: 3 }]);
});

it('sorts groups descending by count', () => {
  const result = toBarData([
    { value: 'Engineering', count: 2 },
    { value: 'Science', count: 9 },
  ]);
  expect(result.map((r) => r.label)).toEqual(['Science', 'Engineering']);
});

it('maps committee activity rows to bar data, preserving backend order', () => {
  const result = committeeActivityToBarData([
    { fullName: 'Jane Doe', actionCount: 12 },
    { fullName: 'John Smith', actionCount: 5 },
  ]);
  expect(result).toEqual([
    { label: 'Jane Doe', value: 12 },
    { label: 'John Smith', value: 5 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/analytics/__tests__/shape.test.ts`
Expected: FAIL — `Cannot find module '@/features/analytics/shape'`

- [ ] **Step 3: Implement `shape.ts`**

Create `frontend/features/analytics/shape.ts`:

```ts
export interface BarDatum {
  label: string;
  value: number;
}

// demographics.faculty/.programme groups can carry value: null (member
// never set it) — rendered as "Unspecified", never left blank.
export function toBarData(groups: { value: string | null; count: number }[]): BarDatum[] {
  return groups
    .map((g) => ({ label: g.value ?? 'Unspecified', value: g.count }))
    .sort((a, b) => b.value - a.value);
}

// committee-activity rows arrive pre-sorted descending by the backend
// (AnalyticsService#getCommitteeActivity) — no re-sort here.
export function committeeActivityToBarData(
  rows: { fullName: string; actionCount: number }[],
): BarDatum[] {
  return rows.map((r) => ({ label: r.fullName, value: r.actionCount }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/analytics/__tests__/shape.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/features/analytics/shape.ts frontend/features/analytics/__tests__/shape.test.ts
git commit -m "feat(frontend): bar-chart shaping helpers for demographics and committee activity"
```

---

### Task 3: Event-title resolver for the feedback table

**Files:**
- Create: `frontend/features/analytics/resolve-event-title.ts`
- Test: `frontend/features/analytics/__tests__/resolve-event-title.test.ts`

**Interfaces:**
- Consumes: `Event` from `@/types/api` (existing, has `id: string` and `title: string`).
- Produces: `resolveEventTitle(eventId: string, events: Event[]): string` — consumed by Task 7's `FeedbackTable`.

- [ ] **Step 1: Write the failing test**

Create `frontend/features/analytics/__tests__/resolve-event-title.test.ts`:

```ts
import { expect, it } from 'vitest';
import { resolveEventTitle } from '@/features/analytics/resolve-event-title';
import type { Event } from '@/types/api';

const event = { id: 'e1', title: 'Orientation Day' } as Event;

it('resolves a known event id to its title', () => {
  expect(resolveEventTitle('e1', [event])).toBe('Orientation Day');
});

it('falls back to the raw id when the event is not in the list', () => {
  expect(resolveEventTitle('missing', [event])).toBe('missing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/analytics/__tests__/resolve-event-title.test.ts`
Expected: FAIL — `Cannot find module '@/features/analytics/resolve-event-title'`

- [ ] **Step 3: Implement `resolve-event-title.ts`**

Create `frontend/features/analytics/resolve-event-title.ts`:

```ts
import type { Event } from '@/types/api';

// Mirrors the resolveMemberName/resolveParticipantName precedent (Slices
// 5/6) — a client-side join with a raw-id fallback on a lookup miss.
export function resolveEventTitle(eventId: string, events: Event[]): string {
  return events.find((e) => e.id === eventId)?.title ?? eventId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/analytics/__tests__/resolve-event-title.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/features/analytics/resolve-event-title.ts frontend/features/analytics/__tests__/resolve-event-title.test.ts
git commit -m "feat(frontend): event-title resolver for the analytics feedback table"
```

---

### Task 4: `HorizontalBarChart` component

**Files:**
- Create: `frontend/components/analytics/horizontal-bar-chart.tsx`

**Interfaces:**
- Consumes: `BarDatum` (Task 2), `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartConfig` from `@/components/ui/chart` (Task 1).
- Produces: `HorizontalBarChart({ data }: { data: BarDatum[] })` — consumed by Task 9's page wiring for Faculty, Programme, and Committee Activity.

No test file — matches this codebase's convention that chart/visual rendering components are live-verification-only (Recharts renders through layout APIs jsdom doesn't implement well). Deliverable verified by `npm run build`.

- [ ] **Step 1: Implement `horizontal-bar-chart.tsx`**

Create `frontend/components/analytics/horizontal-bar-chart.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify the build stays clean**

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/analytics/horizontal-bar-chart.tsx
git commit -m "feat(frontend): HorizontalBarChart component"
```

---

### Task 5: `SingleSeriesLineChart` component

**Files:**
- Create: `frontend/components/analytics/single-series-line-chart.tsx`

**Interfaces:**
- Consumes: `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartConfig` from `@/components/ui/chart` (Task 1).
- Produces: `interface LineDatum { date: string; value: number | null }`, `SingleSeriesLineChart({ data, label }: { data: LineDatum[]; label: string })` — consumed by Task 9's page wiring for Registration Trend, Member Growth, and NPS Trend.

No test file — same rationale as Task 4. Deliverable verified by `npm run build`.

- [ ] **Step 1: Implement `single-series-line-chart.tsx`**

Create `frontend/components/analytics/single-series-line-chart.tsx`:

```tsx
'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export interface LineDatum {
  date: string;
  value: number | null;
}

export function SingleSeriesLineChart({ data, label }: { data: LineDatum[]; label: string }) {
  const config: ChartConfig = { value: { label, color: 'var(--chart-1)' } };

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <LineChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Verify the build stays clean**

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/analytics/single-series-line-chart.tsx
git commit -m "feat(frontend): SingleSeriesLineChart component"
```

---

### Task 6: `RatingsTrendChart` component

**Files:**
- Create: `frontend/components/analytics/ratings-trend-chart.tsx`

**Interfaces:**
- Consumes: `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartLegend`/`ChartLegendContent`/`ChartConfig` from `@/components/ui/chart` (Task 1). Uses `chart-1`/`chart-2`/`chart-3` (Task 1) as its 3 fixed series colors.
- Produces: `interface RatingsDatum { date: string; content: number | null; organization: number | null; venue: number | null }`, `RatingsTrendChart({ data }: { data: RatingsDatum[] })` — consumed by Task 9's page wiring for the Feedback section.

No test file — same rationale as Task 4. Deliverable verified by `npm run build`.

- [ ] **Step 1: Implement `ratings-trend-chart.tsx`**

Create `frontend/components/analytics/ratings-trend-chart.tsx`:

```tsx
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
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis domain={[1, 5]} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="content"
          type="monotone"
          stroke="var(--color-content)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          dataKey="organization"
          type="monotone"
          stroke="var(--color-organization)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          dataKey="venue"
          type="monotone"
          stroke="var(--color-venue)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Verify the build stays clean**

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/analytics/ratings-trend-chart.tsx
git commit -m "feat(frontend): RatingsTrendChart component"
```

---

### Task 7: `FeedbackTable` component

**Files:**
- Create: `frontend/components/analytics/feedback-table.tsx`

**Interfaces:**
- Consumes: `resolveEventTitle` (Task 3), `useAnalyticsFeedback` (Task 8 — this task is written after Task 8's hooks exist; if executing tasks in order, swap Task 7 and Task 8, or note this component is wired against the hook signature defined below and implemented once Task 8 lands). `useEvents` from `@/features/events/use-events` (existing). `useOrg` from `@/features/orgs/org-provider` (existing).
- Produces: `FeedbackTable({ orgId }: { orgId: string })` — consumed by Task 9's page wiring for the Feedback section.

No test file — same rationale as Task 4 (this component's only real logic, `resolveEventTitle`, is already tested in Task 3). Deliverable verified by `npm run build`.

**Note on ordering:** this component calls `useAnalyticsFeedback`, defined in Task 8. Implement Task 8 (hooks) before this task's code will type-check — do Task 8 first if executing strictly in file-dependency order; the numbering here follows the spec's presentation order (component primitives, then data layer), not a strict dependency order. Either order produces the same final code.

- [ ] **Step 1: Implement `feedback-table.tsx`**

Create `frontend/components/analytics/feedback-table.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useAnalyticsFeedback } from '@/features/analytics/use-analytics';
import { useEvents } from '@/features/events/use-events';
import { resolveEventTitle } from '@/features/analytics/resolve-event-title';
import { useOrg } from '@/features/orgs/org-provider';

function fmt(v: number) {
  return v.toFixed(1);
}

export function FeedbackTable({ orgId }: { orgId: string }) {
  const { org } = useOrg();
  const feedback = useAnalyticsFeedback(orgId);
  const events = useEvents(orgId);

  if (feedback.isPending) return null;
  if (feedback.isError || !feedback.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load feedback data.</p>;
  }
  if (feedback.data.data.length === 0) {
    return <p className="py-4 text-center text-sm text-foreground-muted">No feedback submitted yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-foreground-muted uppercase">
            <th className="py-2 pr-4 font-medium">Event</th>
            <th className="py-2 pr-4 font-medium">Responses</th>
            <th className="py-2 pr-4 font-medium">NPS</th>
            <th className="py-2 pr-4 font-medium">Content</th>
            <th className="py-2 pr-4 font-medium">Organization</th>
            <th className="py-2 font-medium">Venue</th>
          </tr>
        </thead>
        <tbody>
          {feedback.data.data.map((row) => (
            <tr key={row.eventId} className="border-b border-border last:border-0">
              <td className="py-2 pr-4">
                <Link href={`/${org.slug}/feedback/${row.eventId}`} className="hover:underline">
                  {resolveEventTitle(row.eventId, events.data ?? [])}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{row.responseCount}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgNpsScore)}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgContentRating)}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgOrganizationRating)}</td>
              <td className="py-2 tabular-nums">{fmt(row.avgVenueRating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build stays clean (once Task 8 exists)**

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/analytics/feedback-table.tsx
git commit -m "feat(frontend): FeedbackTable component"
```

---

### Task 8: `use-analytics.ts` hooks + `KpiCard` extension

**Files:**
- Create: `frontend/features/analytics/use-analytics.ts`
- Modify: `frontend/components/dashboard/kpi-card.tsx`

**Interfaces:**
- Consumes: `api` from `@/lib/api` (existing).
- Produces: `useAnalyticsOverview(orgId)`, `useAnalyticsCertificates(orgId)`, `useAnalyticsTrends(orgId, days)`, `useAnalyticsDemographics(orgId)`, `useCommitteeActivity(orgId, days)`, `useAnalyticsFeedback(orgId)`, `useAnalyticsFeedbackTrends(orgId, days)` — all consumed by Task 9's page wiring and Task 7's `FeedbackTable`. `KpiCard` gains `value: number | null` (was `number`) and an optional `format?: (value: number) => string` prop (defaults to the existing `formatCount`) — backward-compatible, the Dashboard slice's 4 existing call sites are unaffected (they pass plain numbers, never `null`, and no `format` prop).

No test file for the hooks (matches this codebase's convention — data-layer hooks are integration-only, verified live). No test file for the `KpiCard` change either (it never had one; the Dashboard slice's 4 call sites already implicitly cover the unchanged default path via live verification). Deliverable verified by `npm run build` plus the existing dashboard still rendering correctly.

- [ ] **Step 1: Implement `use-analytics.ts`**

Create `frontend/features/analytics/use-analytics.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

function base(orgId: string) {
  return `/organizations/${orgId}/analytics`;
}

export interface AnalyticsOverview {
  attendanceRate: number | null;
}

export interface AnalyticsCertificates {
  issued: number;
  downloaded: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface MemberGrowthPoint {
  date: string;
  cumulativeActive: number;
}

export interface AnalyticsTrends {
  registrationTrend: TrendPoint[];
  memberGrowth: MemberGrowthPoint[];
}

export interface DemographicGroup {
  value: string | null;
  count: number;
}

export interface AnalyticsDemographics {
  faculty: DemographicGroup[];
  programme: DemographicGroup[];
}

export interface CommitteeActivityRow {
  userId: string;
  fullName: string;
  role: string;
  actionCount: number;
}

export interface CommitteeActivity {
  data: CommitteeActivityRow[];
}

export interface FeedbackAggregateRow {
  eventId: string;
  responseCount: number;
  avgNpsScore: number;
  avgContentRating: number;
  avgOrganizationRating: number;
  avgVenueRating: number;
}

export interface AnalyticsFeedback {
  data: FeedbackAggregateRow[];
}

export interface FeedbackTrendPoint {
  date: string;
  responseCount: number;
  avgNpsScore: number | null;
  avgContentRating: number | null;
  avgOrganizationRating: number | null;
  avgVenueRating: number | null;
}

export interface AnalyticsFeedbackTrends {
  trend: FeedbackTrendPoint[];
}

export function useAnalyticsOverview(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'overview'],
    queryFn: () => api<AnalyticsOverview>(`${base(orgId)}/overview`),
  });
}

export function useAnalyticsCertificates(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'certificates'],
    queryFn: () => api<AnalyticsCertificates>(`${base(orgId)}/certificates`),
  });
}

export function useAnalyticsTrends(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'trends', days],
    queryFn: () => api<AnalyticsTrends>(`${base(orgId)}/trends?days=${days}`),
  });
}

export function useAnalyticsDemographics(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'demographics'],
    queryFn: () => api<AnalyticsDemographics>(`${base(orgId)}/demographics`),
  });
}

export function useCommitteeActivity(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'committee-activity', days],
    queryFn: () => api<CommitteeActivity>(`${base(orgId)}/committee-activity?days=${days}`),
  });
}

export function useAnalyticsFeedback(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'feedback'],
    queryFn: () => api<AnalyticsFeedback>(`${base(orgId)}/feedback`),
  });
}

export function useAnalyticsFeedbackTrends(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'feedback-trends', days],
    queryFn: () => api<AnalyticsFeedbackTrends>(`${base(orgId)}/feedback-trends?days=${days}`),
  });
}
```

- [ ] **Step 2: Extend `KpiCard` to accept `null` and an optional formatter**

In `frontend/components/dashboard/kpi-card.tsx`, replace the full file with:

```tsx
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCount } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: number | null;
  icon: LucideIcon;
  /** Domain-hue classes for the icon chip: [text color, tint background]. */
  hue: [string, string];
  /** Defaults to formatCount (plain integer). Pass e.g. formatPercent for a ratio. */
  format?: (value: number) => string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  hue: [textClass, bgClass],
  format = formatCount,
}: KpiCardProps) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
            {label}
          </span>
          <span className="font-heading text-3xl font-semibold tabular-nums">
            {value === null ? '—' : format(value)}
          </span>
        </div>
        <div className={cn('flex size-8 items-center justify-center rounded-md', bgClass)}>
          <Icon className={cn('size-4', textClass)} />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Verify the full suite and build stay clean**

Run: `cd frontend && npm test -- --run`
Expected: PASS, 106 tests (98 baseline + 3 format.test.ts from Task 1 + 3 shape.test.ts from Task 2 + 2 resolve-event-title.test.ts from Task 3 — unchanged by this task, no new test files here), 0 failures

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/features/analytics/use-analytics.ts frontend/components/dashboard/kpi-card.tsx
git commit -m "feat(frontend): analytics data hooks + KpiCard null/formatter support"
```

---

### Task 9: Analytics page wiring

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/analytics/page.tsx` (replaces the `PlaceholderPage` entirely)

**Interfaces:**
- Consumes: everything from Tasks 1–8 — `formatPercent` (1), `toBarData`/`committeeActivityToBarData` (2), `HorizontalBarChart` (4), `SingleSeriesLineChart` (5), `RatingsTrendChart` (6), `FeedbackTable` (7), all 7 `use-analytics.ts` hooks + extended `KpiCard` (8). `isCommittee` from `@/features/orgs/roles` (existing), `useOrg` from `@/features/orgs/org-provider` (existing).
- Produces: the page itself — no further consumers.

No test file — page-level composition, verified by `npm run build` and Task 10's live verification.

- [ ] **Step 1: Replace the page**

Replace the full contents of `frontend/app/(app)/[orgSlug]/analytics/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Award, ChartNoAxesCombined, Download, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { HorizontalBarChart } from '@/components/analytics/horizontal-bar-chart';
import { SingleSeriesLineChart } from '@/components/analytics/single-series-line-chart';
import { RatingsTrendChart } from '@/components/analytics/ratings-trend-chart';
import { FeedbackTable } from '@/components/analytics/feedback-table';
import {
  useAnalyticsOverview,
  useAnalyticsCertificates,
  useAnalyticsTrends,
  useAnalyticsDemographics,
  useCommitteeActivity,
  useAnalyticsFeedbackTrends,
} from '@/features/analytics/use-analytics';
import { formatPercent } from '@/features/analytics/format';
import { toBarData, committeeActivityToBarData } from '@/features/analytics/shape';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export default function AnalyticsPage() {
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const [days, setDays] = useState<Range>(30);

  const overview = useAnalyticsOverview(org.id);
  const certificates = useAnalyticsCertificates(org.id);
  const trends = useAnalyticsTrends(org.id, days);
  const demographics = useAnalyticsDemographics(org.id);
  const committeeActivity = useCommitteeActivity(org.id, days);
  const feedbackTrends = useAnalyticsFeedbackTrends(org.id, days);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <ChartNoAxesCombined className="size-5 text-domain-analytics" />
        </div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-foreground-muted">
          Analytics are for committee. Check back once you&apos;re part of the committee.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="flex w-fit rounded-md border border-border p-0.5">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant="ghost"
              size="sm"
              onClick={() => setDays(r)}
              className={cn(days === r && 'bg-primary/10 text-primary')}
            >
              {r}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Attendance rate"
          value={overview.data?.attendanceRate ?? null}
          icon={Percent}
          hue={['text-domain-attendance', 'bg-domain-attendance/10']}
          format={formatPercent}
        />
        <KpiCard
          label="Certificates issued"
          value={certificates.data?.issued ?? null}
          icon={Award}
          hue={['text-domain-certificates', 'bg-domain-certificates/10']}
        />
        <KpiCard
          label="Certificates downloaded"
          value={certificates.data?.downloaded ?? null}
          icon={Download}
          hue={['text-domain-certificates', 'bg-domain-certificates/10']}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Growth &amp; registrations</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Registration trend</p>
            {trends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <SingleSeriesLineChart
                data={(trends.data?.registrationTrend ?? []).map((t) => ({
                  date: t.date,
                  value: t.count,
                }))}
                label="Registrations"
              />
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Member growth</p>
            {trends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <SingleSeriesLineChart
                data={(trends.data?.memberGrowth ?? []).map((t) => ({
                  date: t.date,
                  value: t.cumulativeActive,
                }))}
                label="Active members"
              />
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Demographics</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Faculty</p>
            {demographics.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <HorizontalBarChart data={toBarData(demographics.data?.faculty ?? [])} />
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Programme</p>
            {demographics.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <HorizontalBarChart data={toBarData(demographics.data?.programme ?? [])} />
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Committee activity</h2>
        <div className="rounded-lg border border-border p-4">
          {committeeActivity.isPending ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <HorizontalBarChart
              data={committeeActivityToBarData(committeeActivity.data?.data ?? [])}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">NPS trend</p>
            {feedbackTrends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <SingleSeriesLineChart
                data={(feedbackTrends.data?.trend ?? []).map((t) => ({
                  date: t.date,
                  value: t.avgNpsScore,
                }))}
                label="NPS"
              />
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Ratings trend</p>
            {feedbackTrends.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <RatingsTrendChart
                data={(feedbackTrends.data?.trend ?? []).map((t) => ({
                  date: t.date,
                  content: t.avgContentRating,
                  organization: t.avgOrganizationRating,
                  venue: t.avgVenueRating,
                }))}
              />
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <FeedbackTable orgId={org.id} />
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify the full suite and build stay clean**

Run: `cd frontend && npm test -- --run`
Expected: PASS, 101 tests, 0 failures

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/analytics/page.tsx"
git commit -m "feat(frontend): analytics page wiring — KPIs, trends, demographics, committee activity, feedback"
```

---

### Task 10: Live verification (pause before this task — standing preference)

No code changes. Drive the real flow against the real dev backend (`docker compose up -d` first if the stack has stopped since the last session), both themes.

- [ ] **Step 1: Confirm backend + frontend dev servers are running**

Run: `cd backend && docker compose ps` — confirm postgres/minio/redis/mailpit are up; `docker compose up -d` if not.
Confirm `npm run start:dev` (backend) and `npm run dev` (frontend) are running, or start them.

- [ ] **Step 2: Seed enough data for meaningful charts**

The org used for Slice 7's verification (`slice7-org-*`) has one completed event, one PRESENT attendee, one feedback response, one member with a role change — enough to render *something* in every section, but demographics/trends will look sparse (1 data point). Register 1–2 more accounts as PARTICIPANT with different `faculty`/`programme` values (via `PATCH /organizations/:orgId/members/:membershipId` or the Members UI edit page) so the Demographics bar charts show more than a single bar, and complete a second event so Registration Trend/Member Growth have more than one point.

- [ ] **Step 3: Full page walkthrough as committee**

Log in as the committee/president account, navigate to `/analytics`. Confirm: KPI row shows a real percentage (not "—" unless genuinely no resolved attendance) and both certificate counts; Registration Trend and Member Growth render as line charts with the seeded data points; Faculty/Programme bar charts show the seeded distribution including an "Unspecified" bar if any member has no faculty/programme set; Committee Activity bar chart shows ranked action counts; NPS Trend and Ratings Trend line charts render (Ratings Trend shows all 3 series with a legend); the Feedback table shows the seeded event(s) with correct averages and each row links to the correct `/feedback/[eventId]` page (verify at least one click-through).

- [ ] **Step 4: Date-range control**

Click 7d / 30d / 90d and confirm Registration Trend, Member Growth, Committee Activity, NPS Trend, and Ratings Trend all re-fetch and re-render together (the shared control governs all five); confirm the KPI row and Demographics/Feedback sections do NOT change (they're all-time snapshots).

- [ ] **Step 5: RBAC check**

Log in as (or switch to) a non-committee PARTICIPANT account, navigate to `/analytics` directly, confirm the explainer renders instead of the dashboard.

- [ ] **Step 6: Color + theme check**

Screenshot the page in both light and dark mode. Confirm chart colors read clearly against the surface in both modes (this is what Task 1's `validate_palette.js` run was verifying numerically — this step is the visual confirmation the skill's step 7 also requires: "render it and look at it"). Confirm no domain-hue leakage onto non-chart UI elements.

- [ ] **Step 7: Record findings**

If zero bugs found: no commit (mirrors Slices 1, 2, 4, 5, 7). If any bug is found: fix it, add/adjust a test if the bug was in unit-testable logic (Tasks 1–3's shaping/formatting functions), commit with a `fix(frontend):` (or `fix(backend):` if a genuine pre-existing backend defect is surfaced) message.

---

## Post-implementation (outside this plan, per standing workflow)

After Task 10 passes with zero or fixed bugs: **pause before docs-sync** (standing preference) — wait for "continue," then append a "Slice 8" section to `docs/uiux.md` and update `docs/current-context.md`. Then **finish branch**: verify tests, merge `feature/frontend-slice8-analytics` to `main` locally, delete the branch — no push, no asking (standing default).

---

## Self-Review Notes

- **Spec coverage:** every chart-form-mapping row in the spec has a task — `overview`/`certificates` → Task 8 hooks + Task 9 KPI tiles; `trends` → Task 5 component + Task 9 wiring; `demographics` → Task 2 shaping + Task 4 component + Task 9 wiring; `committee-activity` → Task 2 shaping + Task 4 component + Task 9 wiring; `feedback` → Task 3 resolver + Task 7 table; `feedback-trends` (NPS) → Task 5 component + Task 9 wiring; `feedback-trends` (ratings) → Task 6 component + Task 9 wiring. Color tokens, RBAC, and the shared date-range control are all covered in Tasks 1 and 9. "Out of scope" items (no backend changes, no export, no per-chart date ranges, no derived metrics beyond backend fields, no per-chart table fallback) are respected — nothing in any task introduces them.
- **Placeholder scan:** no TBD/TODO; every step has complete, exact code. One deliberate ordering note (Task 7 depends on Task 8's hook) is flagged explicitly rather than hidden, with the actual resolution stated (implement Task 8 first if executing strictly in dependency order).
- **Type consistency:** `BarDatum` (Task 2) is the exact type `HorizontalBarChart` (Task 4) consumes and what `toBarData`/`committeeActivityToBarData` (Task 2) both return — verified identical field names (`label`, `value`) across all three. `LineDatum`/`RatingsDatum` (Tasks 5/6) match exactly what Task 9's `.map()` calls construct (`date`/`value` and `date`/`content`/`organization`/`venue` respectively — every field present, no typos against the hook return types from Task 8: `TrendPoint.count`, `MemberGrowthPoint.cumulativeActive`, `FeedbackTrendPoint.avgNpsScore`/`avgContentRating`/`avgOrganizationRating`/`avgVenueRating`, all confirmed to match the backend's actual JSON shape read from `analytics.service.ts` during brainstorming). `KpiCard`'s new `value: number | null` + `format?` (Task 8) matches its 3 call sites in Task 9 exactly (`overview.data?.attendanceRate ?? null` with `format={formatPercent}`; the two certificate tiles passing no `format`, defaulting to `formatCount`).
- **Test count arithmetic:** verified against each task's actual new test file — 98 (baseline) + 3 (`format.test.ts`, Task 1) + 3 (`shape.test.ts`, Task 2) + 2 (`resolve-event-title.test.ts`, Task 3) = **106**. Tasks 8 and 9 add no new test files, so their checkpoints both read 106; both are stated correctly inline at their Step 3/Step 2 checkpoints.
