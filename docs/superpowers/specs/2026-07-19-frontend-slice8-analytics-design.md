# Frontend Slice 8 — Analytics — Design

Date: 2026-07-19
Status: approved (design sections), pending spec review sign-off

## Scope

Full frontend surface for the backend's already-shipped `AnalyticsService`
(Phase 2): one `/analytics` page, committee-only, covering all 7 endpoints
in sections on a single page (not split across slices — mirrors how the
Basic Dashboard slice bundled multiple widget types into one page). First
frontend slice that needs real charts (line/bar) — nothing chart-capable
is installed yet.

**No new backend endpoints.** All 7 read directly from
`backend/src/analytics/analytics.controller.ts`, every route
`@Roles(...MANAGE_EVENTS)`-gated:

- `GET /organizations/:orgId/analytics/overview` → `{ attendanceRate: number | null }`
- `GET /organizations/:orgId/analytics/certificates` → `{ issued: number, downloaded: number }`
- `GET /organizations/:orgId/analytics/trends?days=N` → `{ registrationTrend: {date,count}[], memberGrowth: {date,cumulativeActive}[] }`
- `GET /organizations/:orgId/analytics/demographics` → `{ faculty: {value:string|null,count}[], programme: {value:string|null,count}[] }`
- `GET /organizations/:orgId/analytics/committee-activity?days=N` → `{ data: {userId,fullName,role,actionCount}[] }` (pre-sorted descending)
- `GET /organizations/:orgId/analytics/feedback` → `{ data: {eventId,responseCount,avgNpsScore,avgContentRating,avgOrganizationRating,avgVenueRating}[] }`
- `GET /organizations/:orgId/analytics/feedback-trends?days=N` → `{ trend: {date,responseCount,avgNpsScore,avgContentRating,avgOrganizationRating,avgVenueRating}[] }` (averages `null` on a zero-response day)

`days` (backend `parseDaysParam`): non-numeric/≤0 silently defaults to 30,
clamped 1–365 — a reporting window, not a security filter.

## Chart-form mapping (per the `dataviz` skill's method)

Decided by data shape and job, not by taste — see the skill's
`choosing-a-form.md`/`color-formula.md` for the underlying rules this
table applies:

| Endpoint field | Data shape | Form | Color job |
|---|---|---|---|
| `overview.attendanceRate` | single ratio | stat tile (%) | — |
| `certificates.issued` / `.downloaded` | 2 counts | 2 stat tiles | — |
| `trends.registrationTrend` | daily count | single-series line | 1 hue (`chart-1`) |
| `trends.memberGrowth` | daily cumulative | single-series line | 1 hue (`chart-1`) |
| `demographics.faculty` | ranked counts, nullable value | horizontal bar | 1 hue (`chart-1`) |
| `demographics.programme` | ranked counts, nullable value | horizontal bar | 1 hue (`chart-1`) |
| `committee-activity.data` | ranked counts | horizontal bar | 1 hue (`chart-1`) |
| `feedback.data` | per-event, 4 metrics, unbounded row count | table, links to Slice 7's `/feedback/[eventId]` | — |
| `feedback-trends.trend` (NPS) | daily avg, 0–10 scale | single-series line | 1 hue (`chart-1`) |
| `feedback-trends.trend` (ratings) | daily avg × 3, 1–5 scale | 3-series line | categorical (`chart-1`/`2`/`3`) |

Two explicit form decisions, made and rejected during brainstorming:

- **Feedback: table, not a chart.** The per-event list grows unboundedly
  over the org's lifetime — a grouped bar chart (events × 4 metrics)
  breaks down past ~6–7 events and would duplicate what Slice 7's
  per-event feedback summary page already shows. A table scales
  indefinitely and each row links to that existing page instead of
  re-rendering its content as a chart.
- **NPS and the three ratings are never one chart.** Different scales
  (0–10 vs 1–5) — combining them would be a dual-axis chart, the
  `dataviz` skill's explicit non-negotiable ("never two y-scales"). Two
  separate line charts instead: a single-series NPS trend, and a
  3-series Ratings Trend (content/organization/venue, same 1–5 scale, so
  legitimately comparable as categorical series).

## Color

`chart-1` = the existing Analytics domain hue (Forest Green, `#3F9142`
light / `#5FB563` dark) — `design.md`'s own domain-hue table already
lists this hue's use as "chart accents, growth indicators," unlike every
other domain hue (icons/tags/badges only) — so no new hue is invented for
the single-hue charts (all magnitude bars + all single-series lines).
Ordinary bar/line marks use one flat color, not a lightness ramp (per the
`dataviz` skill's `marks-and-anatomy.md` — a ramp is for heatmaps/choropleths,
not for a chart where bar length/line position already encodes magnitude).

`chart-2`/`chart-3` (needed only for the 3-series Ratings Trend) are
picked from the existing design-system hue families and validated via the
`dataviz` skill's `scripts/validate_palette.js` (the "snap-to-passing"
method: pick candidates, run the validator, nudge lightness on any
adjacent pair that fails the CVD floor) — exact hex chosen and validated
as an implementation task, not pinned in this spec. All three tokens are
added to `app/globals.css` as `--chart-1`/`--chart-2`/`--chart-3` (light +
dark), the naming convention shadcn's chart component itself expects.

## Component architecture

Two generic, reusable chart primitives instead of seven bespoke ones —
`frontend/components/analytics/`:

- `horizontal-bar-chart.tsx` — `{ data: {label: string; value: number}[] }`,
  ranked/sorted by the caller before rendering. 3 call sites: Faculty,
  Programme, Committee Activity (label = `fullName`, with `role` as
  secondary text).
- `single-series-line-chart.tsx` — `{ data: {date: string; value: number | null}[]; label: string }`,
  null values render as a gap in the line (never fabricated/interpolated).
  3 call sites: Registration Trend, Member Growth, NPS Trend.
- `ratings-trend-chart.tsx` — fixed 3-series line
  (content/organization/venue), 1 call site — kept separate from
  `single-series-line-chart.tsx` rather than generalizing to N series,
  since this is the only multi-series chart in the slice and a generic
  N-series abstraction would be speculative (YAGNI).
- `feedback-table.tsx` — 1 call site, each row links to
  `/${org.slug}/feedback/${eventId}` (Slice 7's existing page — no new
  route).
- KPI row reuses the existing `components/dashboard/kpi-card.tsx` pattern
  (3 tiles: Attendance Rate formatted as a percentage, Certificates
  Issued, Certificates Downloaded) — not a new component, just three
  `<KpiCard>` call sites on the Analytics page.

`shadcn`'s chart component (`npx shadcn add chart`, Recharts-based,
CSS-variable themed) is added as the underlying primitive both
`horizontal-bar-chart.tsx` and the two line-chart components wrap — this
codebase's first Recharts dependency.

## Page layout

`app/(app)/[orgSlug]/analytics/page.tsx` replaces the `PlaceholderPage`.
One shared date-range control (`7 | 30 | 90` days, default 30, plain local
`useState` — no URL/query-string persistence, matching every other filter
in this app, e.g. the events status filter) drives the three
day-windowed endpoints (`trends`, `committee-activity`,
`feedback-trends`); the other four (`overview`, `certificates`,
`demographics`, `feedback`) are all-time snapshots, unaffected by it.

Sections, top to bottom:
1. KPI row (3 tiles, all-time)
2. "Growth & Registrations" — Registration Trend + Member Growth (2 line
   charts, windowed)
3. "Demographics" — Faculty + Programme (2 bar charts, all-time)
4. "Committee Activity" — 1 bar chart, windowed
5. "Feedback" — NPS Trend + Ratings Trend (2 line charts, windowed) +
   feedback table (all-time)

## RBAC

Every endpoint is `MANAGE_EVENTS`-gated on the backend — the page reuses
`isCommittee` exactly like the Certificates/Attendance/Feedback pages. A
non-committee account visiting `/analytics` sees the same
explainer-page pattern (domain-hue icon + "Analytics is for committee"
message) instead of the dashboard. No new role helper.

## Data hooks

`frontend/features/analytics/use-analytics.ts` — one `useQuery` per
endpoint (all read-only, no mutations, no invalidation needed):

- `useAnalyticsOverview(orgId)`
- `useAnalyticsCertificates(orgId)`
- `useAnalyticsTrends(orgId, days)`
- `useAnalyticsDemographics(orgId)`
- `useCommitteeActivity(orgId, days)`
- `useAnalyticsFeedback(orgId)`
- `useAnalyticsFeedbackTrends(orgId, days)`

`demographics.faculty`/`.programme` groups can include a `value: null`
entry (member never set faculty/programme) — rendered as "Unspecified" in
the bar chart's shaping layer, never left blank.

## Testing

Pure-logic unit tests only (Vitest) — no direct chart-component tests.
Recharts renders through `ResizeObserver`/layout APIs jsdom doesn't
implement well, and every prior "visual" component in this app
(`MyCertificatePanel`, `CertificateManager`, `FeedbackSummary`, etc.) has
been live-verification-only, not unit-tested, for the same reason.

- A shaping/formatting function per chart primitive, tested directly as
  *our* logic separate from the rendering component it feeds: e.g.
  `toBarData(groups: {value: string | null; count: number}[])` →
  null-to-"Unspecified", sorted descending by count.
- `formatPercent(ratio: number | null)` → `"78%"` / `"—"` for the
  attendance-rate KPI tile, if not already covered by an existing
  formatter in `features/dashboard/format.ts`.

Live verification (standing preference — pause before this task): full
page load against the real dev backend with real data (the existing
Slice 7 test org already has one completed event, one PRESENT attendee,
one feedback response — likely needs 1–2 more completed events/registrations
seeded for demographics/trends to show something other than a single
data point); date-range control changing all three windowed sections
together; non-committee account sees the explainer, not the dashboard;
both themes; chart colors validated via `dataviz`'s
`validate_palette.js` script before this pass (never eyeballed, per the
skill's core rule).

## Out of scope

- No backend changes — all 7 endpoints pre-exist and are read directly
  from source.
- No CSV/PDF export of any analytics view.
- No per-chart independent date ranges (one shared control, per the
  brainstorming decision).
- No derived metrics beyond what the backend returns (e.g. no
  client-computed "certificate download rate" — `issued`/`downloaded`
  ship as two separate stat tiles, not a ratio the backend doesn't
  provide).
- No table/list view fallback beyond what's specified above (the
  `dataviz` skill's "always ship a table view" accessibility guidance is
  satisfied here by the underlying data already being simple enough to
  read from tooltips/axis labels — not adding a redundant full data-table
  per chart is a deliberate scope call, revisit only if live verification
  surfaces a real accessibility gap).
