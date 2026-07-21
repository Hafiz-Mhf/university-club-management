# Frontend Slice 16 — Committee Handover Pack — Design

**Status:** approved, pending implementation.

## Scope

Last remaining Phase 2 item (`docs/roadmap.md`). Committee-side "Download
Handover Pack" action for the already-shipped `HandoverController`
(`backend/src/handover/handover.controller.ts`) — a single
`GET /organizations/:orgId/handover` route that streams a generated PDF
(roster, recent meeting minutes, asset inventory, key files, upcoming
events). No new backend endpoints. Closes out Phase 2 — Organization
Workspace entirely.

## RBAC

Matches `HandoverController` exactly: `@Roles(...MANAGE_EVENTS)`, i.e.
`isCommittee` frontend tier. The action lives inside `OrganizationTab`,
which is only ever rendered when `SettingsPage` has already gated the
"Organization" tab to `isCommittee` — no additional RBAC check is needed
inside `OrganizationTab` itself.

## New client capability: binary download

Every existing frontend download (Files, Certificates) goes through a
signed-URL indirection: the API returns `{ downloadUrl }` as JSON, and the
frontend redirects/opens that URL. The handover endpoint is different — it
streams the PDF bytes directly from the API response
(`Content-Type: application/pdf`), with no signed URL involved. `api()` in
`frontend/lib/api.ts` always JSON-parses the response body, so it cannot
be reused as-is for this route.

Add `apiDownloadBlob(path: string): Promise<Blob>` to `frontend/lib/api.ts`,
a sibling to `api()`/`apiUpload()`. It reuses the existing internal
`request()` helper (bearer token attach + 401→refresh→retry cycle,
unchanged), but on a successful response calls `res.blob()` instead of
JSON-parsing, and on a failed response parses the JSON error body the same
way `api()` does (NestJS error responses stay JSON even on a route that
normally streams binary) and throws the same `ApiError`.

## Data layer

`frontend/features/handover/use-handover.ts`:
- `useDownloadHandoverPack(orgId)` — a `useMutation` wrapping
  `apiDownloadBlob('/organizations/${orgId}/handover')`. No query, no
  cache invalidation — a one-shot generate-and-download action, not
  persisted state.

## Component

`frontend/components/orgs/handover-pack-button.tsx` — copies
`frontend/components/account/export-data-button.tsx`'s shape almost
verbatim (same `Button` + `Loader2` spinner while pending, same inline
`role="alert"` error text on failure). On success: builds a blob URL via
`URL.createObjectURL`, clicks a throwaway `<a download>`, revokes the URL.
Filename: `handover-pack-${org.slug}-${YYYY-MM-DD}.pdf`.

## Page wiring

`frontend/components/orgs/organization-tab.tsx` gets one more `<section>`,
"Handover pack", placed after the existing "Public page" section: a
one-line description of what the PDF contains (committee roster, recent
meeting minutes, asset inventory, key files, upcoming events) plus
`<HandoverPackButton orgId={orgId} orgSlug={org.data.slug} />`.

## Error handling

- API/network failure: inline red `role="alert"` text, same convention as
  every other mutation button in this codebase (`ApiError` message or a
  generic fallback).
- Empty organization (no minutes/assets/files/upcoming events yet): no
  frontend-side handling needed — `handover-pdf.service.ts` already
  renders "None" per empty section server-side, so the button simply
  downloads a mostly-empty PDF. Not a frontend concern.

## Testing

Unit: `apiDownloadBlob` gets three cases added to the existing
`frontend/lib/__tests__/api.test.ts` (mirroring that file's own
conventions for `api()`/`apiUpload()`): success returns a `Blob`; a 401
triggers the shared refresh-then-retry cycle and still returns a `Blob`
on the retried request; a failure response parses the JSON error body and
throws `ApiError` with the right message. No component test for
`HandoverPackButton` — matches `ExportDataButton`'s own precedent (an
untested thin wrapper around a mutation).

Live verification: click as PRESIDENT, confirm a real PDF downloads and
its content matches current org data (roster/minutes/assets/files/
events); confirm a non-committee account still never sees the
Organization tab at all (pre-existing gating, not new — nothing further
to verify there beyond a quick sanity check); both themes screenshotted
(the button/section itself, not the PDF — PDFs aren't themed).

No new backend endpoints. Backend test baseline expected unchanged (101
unit / 327 e2e) unless a real defect is found live.

## What this completes

This is the last unshipped item on Phase 2 — Organization Workspace
(`docs/roadmap.md`). After this slice, Phase 2 is fully shipped, backend
and frontend both.
