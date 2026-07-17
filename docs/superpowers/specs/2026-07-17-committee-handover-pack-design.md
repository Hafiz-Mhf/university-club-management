# Committee Handover Pack — Design

Phase 2 item. Roadmap line (`docs/roadmap.md`): "Committee Handover Pack —
export org knowledge on committee rotation." Spec precedent
(`docs/superpowers/specs/2026-07-10-club-management-platform-design.md:161-162`):
"export org knowledge on committee rotation; solves the 'data lost on
handover' problem." Original brainstorm (`docs/planning.md:150-157`, "Digital
Club Workspace") grouped "committee handover documentation" alongside SOP
repository, yearly reports, and asset inventory — all of which have since
shipped as their own features (File Repository, Asset Management). This
feature is the aggregation layer over that already-shipped data, not a new
place to store anything.

**In:** one PDF report aggregating five existing data sources, generated
on-demand, gated to committee-tier roles, audited.

**Out (deferred, do not build):** frontend (backend-only, consistent with
every other Phase 2 item shipped so far), storing/persisting generated packs
(no `HandoverPack` model, no storage-quota impact), bundling actual file
contents (manifest of titles only, not a ZIP of real documents), configurable
section selection, any new writable data.

---

## Architecture

New `backend/src/handover/` module: `HandoverController`, `HandoverService`,
`HandoverPdfService`.

This is a cross-cutting **read** aggregating five existing models
(`Membership`, `MeetingMinutes`, `Asset`, `OrgFile`, `Event`) — architecturally
identical to the existing `AnalyticsService` (which already queries
`Registration`/`Membership`/`AuditLog` directly rather than importing
`RegistrationsModule`/`MembershipsModule`). `HandoverService` follows the same
pattern: it queries all five models directly via the (global) `PrismaService`,
and `HandoverModule` imports no other feature module. This differs from Event
Feedback + NPS's `FeedbackService` → `CertificateGenerationService` link,
which existed because that call *triggered a mutation* in another feature;
this feature only reads.

No new Prisma model, no BullMQ queue, no MinIO/S3 object. The PDF is rendered
and streamed back synchronously inside the HTTP response — nothing is
persisted, so there's no storage-quota interaction and no stale-snapshot
problem (every request reflects current org state).

**Flow:** `GET /organizations/:orgId/handover` → `HandoverService.generate(organizationId)` gathers all five sections in parallel
(`Promise.all`) → passes the aggregated data to `HandoverPdfService.render(data)`
(pure pdf-lib, zero Prisma dependency, same testability rationale as
`CertificatePdfService` — round-trip-testable via `PDFDocument.load(buffer)`
alone) → audits `handover.generate` → controller sets
`Content-Type: application/pdf` + `Content-Disposition: attachment` and sends
the buffer.

---

## Content sections

All five gathered with direct Prisma queries inside `HandoverService`, in
parallel:

1. **Committee roster** — every `Membership` with `status: 'ACTIVE'` for the
   org, `include: { user: { select: { fullName: true } } }`, ordered
   `joinedAt asc` (mirrors `MembershipsService.list`'s existing shape). Each
   row: name, current `role`, and `committeeHistory` (the existing JSON array
   of `{ role, until }` entries already written by
   `MembershipsService.changeRole` — no new write, this is the first *reader*
   of that field).
2. **Recent meeting minutes** — most recent 10 `MeetingMinutes` rows by
   `meetingDate desc` (title, meetingDate). Capped to avoid an unbounded PDF;
   10 chosen as a reasonable "recent history" window.
3. **Asset inventory** — every `Asset` row for the org (name, quantity,
   condition, location), unpaginated — matches Asset Management's own
   established "inventory is inherently bounded, don't paginate" precedent.
4. **Key files** — `OrgFile` rows where `category IN ('SOP', 'REPORT')`
   (title, category, originalFilename). Titles/filenames only — no signed
   download URLs, since this is a manifest of what exists, not a file bundle.
5. **Upcoming events** — `Event` rows with `status: 'PUBLISHED'` and
   `startAt >= now` (title, startAt, venue) — the same predicate
   `EventsService.listPublicUpcoming` already uses, re-run directly here
   rather than injecting `EventsService` (per the no-cross-module-import
   decision above).

An empty section renders as "None" in the PDF rather than being omitted —
the incoming committee should see "checked, nothing here" rather than
wonder whether a section was skipped.

---

## Endpoint, RBAC, audit, testing

**Endpoint:** `GET /organizations/:orgId/handover` —
`JwtAuthGuard, TenantGuard, RolesGuard` + `@Roles(...MANAGE_EVENTS)`, the same
committee-tier group gating most write/export actions across this app.

**Audit:** `handover.generate` (`targetType: 'Organization'`, `targetId:
organizationId`, empty/minimal metadata — no personal data, no section
contents). This is a deliberate, one-off exception to this codebase's
"reads are never audited" rule established across every prior Phase 2
feature: a full-org data export (committee roster + asset inventory + file
manifest in one response) is a meaningfully different event from a normal
list/detail read, and worth a paper trail.

**Testing (tenant isolation mandatory):**
- Org A's generated pack never contains org B's members, minutes, assets,
  files, or events.
- A member without a `MANAGE_EVENTS` role (e.g. `PARTICIPANT`) gets `403`.
- Cross-org: a president of org B has no `Membership` in org A, so
  `TenantGuard` rejects with `403` before the handler runs — same pattern as
  every other feature's isolation test.
- Empty-org case: all five sections present and render "None" for sections
  with zero rows, not a crash or a missing section.
- Response `Content-Type` is `application/pdf`, and the body round-trips
  through `PDFDocument.load(buffer)` without throwing (byte-valid PDF) —
  mirrors `certificate-pdf.service.spec.ts`'s verification style.
- A successful generation writes exactly one `handover.generate` audit row.

---

## Test baseline to verify before planning

Re-run `npm test` / `npm run test:e2e` in `backend/` and record actual
counts before writing the implementation plan's task numbering — per
standing rule (a past arithmetic mistake during the Analytics phase is why
this exists).
