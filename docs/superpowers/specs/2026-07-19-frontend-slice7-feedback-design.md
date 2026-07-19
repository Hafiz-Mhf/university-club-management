# Frontend Slice 7 — Feedback — Design

Date: 2026-07-19
Status: approved (design sections), pending spec review sign-off

## Scope

Full frontend surface for the backend's existing Event Feedback + NPS feature
(Phase 2, backend already shipped): participant feedback submission on the
event-detail page, committee aggregate summary view via a dedicated nav page,
and the `Event.requireFeedbackForCertificate` gate toggle added to the event
create/edit form (previously unreachable from the frontend — the backend
field existed with no UI to set it).

**No new backend endpoints.** Reuses, as read directly from source:
- `POST /organizations/:orgId/events/:eventId/feedback` — submit (any
  authenticated member; backend itself checks the caller has a `PRESENT`
  attendance row and the 14-day window from `event.endAt` hasn't closed).
- `GET .../feedback/me` — 404 when the caller hasn't submitted.
- `GET .../feedback/summary` — `MANAGE_EVENTS`-gated aggregate (avg NPS,
  avg content/organization/venue ratings, response count, unattributed
  comment list — no per-response breakdown exists in the API).
- `PATCH /organizations/:orgId/events/:eventId` already accepts
  `requireFeedbackForCertificate?: boolean` (`UpdateEventDto`); create uses
  the same DTO shape.

## Architecture

- `frontend/types/api.ts` — add `FeedbackResponse` interface (`id`,
  `organizationId`, `eventId`, `userId`, `npsScore`, `contentRating`,
  `organizationRating`, `venueRating`, `comment: string | null`,
  `createdAt`).
- `frontend/features/feedback/use-feedback.ts`:
  - `useMyFeedback(orgId, eventId)` — `GET .../feedback/me`, `retry: false`
    (404 is a meaningful "not submitted" answer, same convention as
    `useMyAttendance`/`useMyCertificate`).
  - `useSubmitFeedback(orgId, eventId)` — `POST`, invalidates the `me` query
    key on success.
  - `useFeedbackSummary(orgId, eventId)` — `GET .../feedback/summary`,
    committee call sites only.
- `frontend/features/feedback/schemas.ts` — Zod schema mirroring
  `SubmitFeedbackDto`: `npsScore` int 0–10, `contentRating`/
  `organizationRating`/`venueRating` int 1–5 each, optional `comment` string
  ≤2000 chars.
- `frontend/features/feedback/window.ts` — `FEEDBACK_WINDOW_MS` constant
  (14 days, duplicated from backend — no shared package between
  frontend/backend anywhere in this codebase, consistent with existing
  enum/constant duplication) and a pure `isFeedbackWindowOpen(event: Event,
  now: Date): boolean` helper.
- `frontend/features/feedback/panel-state.ts` — pure function
  `resolveFeedbackPanelState(attendanceStatus: AttendanceStatus | undefined,
  feedback: FeedbackResponse | undefined, event: Event, now: Date)` returning
  one of `'hidden' | 'recap' | 'form' | 'window-closed'`. Extracted so the
  branching is unit-testable without mounting the component or mocking
  dates inside it (mirrors Slice 2's event-status-transition helper
  pattern).
- `frontend/components/feedback/rating-scale.tsx` — reusable button-row
  control, `{ min, max, value, onChange, label }` props. Used for all four
  scores (NPS: min=0,max=10; the three ratings: min=1,max=5). One component
  instead of four bespoke widgets — matches the existing app convention of
  plain buttons for discrete choices (event-detail tabs, status filters),
  no new shadcn component.
- `frontend/components/feedback/my-feedback-panel.tsx` — event-detail panel,
  calls `useMyAttendance` + `useMyFeedback` + `resolveFeedbackPanelState`:
  - `hidden` → renders `null` (not a `PRESENT` attendee for this event).
  - `recap` → read-only display of the participant's own four scores +
    comment (already-submitted).
  - `form` → the submit form (NPS + three ratings via `rating-scale.tsx` +
    optional comment textarea), calls `useSubmitFeedback`.
  - `window-closed` → muted single-line note ("The feedback window for this
    event has closed") — consistent with this app's "honest, not
    fake-empty" placeholder philosophy rather than silently hiding.
  - Placed in event-detail overview immediately after `MyCertificatePanel`
    (registration → certificate → feedback, the participant's actual
    chronological journey).
- `frontend/components/feedback/feedback-summary.tsx` — committee aggregate
  view: four stat tiles (avg NPS, avg content, avg organization, avg venue)
  + response count + comment list. No per-response table (the API doesn't
  expose one).
- `frontend/app/(app)/[orgSlug]/feedback/page.tsx` — replaces the
  `PlaceholderPage`. Non-committee: explainer message (mirrors
  Certificates/Attendance non-eligible views). Committee: event picker list
  (non-`DRAFT` events, same list-and-link shape as
  `certificates/page.tsx`/`attendance/page.tsx`) linking to
  `/feedback/[eventId]`.
- `frontend/app/(app)/[orgSlug]/feedback/[eventId]/page.tsx` — new route,
  renders `feedback-summary.tsx` for the picked event.
- `frontend/features/events/schemas.ts` — `eventFormSchema` gains
  `requireFeedbackForCertificate: z.boolean()` default `false`.
- `frontend/features/events/use-events.ts` — `toBody()` sends
  `requireFeedbackForCertificate`.
- Event create/edit form component — add a checkbox near the end of the
  form for `requireFeedbackForCertificate`, labeled to make the gating
  behavior clear (e.g. "Require feedback before releasing certificates").

## RBAC

- Submit / mine: any authenticated org member — no frontend role gate;
  backend enforces the `PRESENT`-attendance + window check itself and
  returns 403/404 accordingly.
- Summary, `/feedback` nav page, and the gate toggle on the event form:
  `isCommittee(role)` (existing helper, mirrors backend `MANAGE_EVENTS`) —
  same tier as the Certificates page. No new role helper needed.

## Data flow / edge cases

- `MyFeedbackPanel` eligibility is resolved via `useMyAttendance(orgId,
  eventId)` (existing hook from Slice 5, same one `my-qr-dialog.tsx` uses)
  — `status === 'PRESENT'` is the gate for showing anything beyond `null`.
  A `GET .../feedback/me` 404 alone can't distinguish "not a PRESENT
  attendee" from "PRESENT but hasn't submitted yet," so the attendance
  check must run first.
- Window check compares `event.endAt + FEEDBACK_WINDOW_MS` against `now`
  (`Date.now()` at render time — no live countdown/ticking needed, this is
  a per-page-load check like every other date comparison in this app).
- Submitting a second time is a 409 from the backend (`ConflictException`,
  duplicate `FeedbackResponse`) — in practice unreachable from the UI once
  `resolveFeedbackPanelState` returns `'recap'` after a successful submit
  (mutation invalidates the `me` query), so no special 409 handling needed
  beyond the default mutation error surface.

## Testing

Unit (Vitest+RTL), logic only, no snapshot tests (consistent with every
prior slice):
- `rating-scale.tsx` — renders `max - min + 1` buttons, calls `onChange`
  with the clicked value.
- `feedback/schemas.ts` — NPS bounds (0–10), rating bounds (1–5), comment
  maxlength, valid-input pass.
- `isFeedbackWindowOpen` — open/closed cases around the 14-day boundary.
- `resolveFeedbackPanelState` — full truth table across attendance status ×
  feedback-submitted × window-open.

Live verification (dev server + Playwright; standing preference — pause
before this task, wait for go-ahead): PRESENT attendee submits feedback →
recap shows correct values → committee views summary page with correct
averages/comment list → non-attendee sees no panel → toggle
`requireFeedbackForCertificate` on an event via the frontend form and
confirm the existing (already backend-tested) cert-gating behavior still
fires end-to-end from a frontend-driven change. Both themes screenshotted,
no domain-hue leakage.

Backend is untouched by this slice — no e2e changes expected; baseline
stays 101 unit / 327 e2e (Slice 6's baseline). Frontend baseline before this
slice: 76/76 — new tests added per the unit list above.

## Out of scope

- No per-response breakdown/table for committee (API doesn't support it).
- No live countdown UI for the feedback window.
- No changes to the backend feedback module, cert-gating logic, or the
  14-day window constant itself — this slice is frontend-only except for
  the pre-existing, already-tested backend behavior it surfaces controls
  for.
