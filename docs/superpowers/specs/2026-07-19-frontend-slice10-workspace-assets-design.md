# Frontend Slice 10 (Workspace — Asset Management) — Design

## Context

Second of three Workspace sub-slices (Workspace bundles three independent
backend subsystems behind one nav item — split the same way
Events/Registrations was in Slice 2/3). File Repository shipped in Slice 9
(the Files tab of `/workspace`). This spec covers **Asset Management only**
— Meeting Minutes remains the third, undesigned sub-slice.

## Scope

Full frontend surface for the already-shipped `AssetsController`: create,
list, edit, remove — a plain inventory CRUD with no file storage involved.
No new backend endpoints — verified directly against
`assets.controller.ts`/`assets.service.ts` during brainstorming:

- `POST /organizations/:orgId/assets` — `MANAGE_EVENTS`-gated.
  `CreateAssetDto`: `name: string`, `quantity: number (int, min 1)`,
  `condition?: AssetCondition`, `location?: string`, `notes?: string`.
- `GET /organizations/:orgId/assets` — any authenticated org member, no
  pagination, `orderBy: { name: 'asc' }`.
- `GET /organizations/:orgId/assets/:assetId` — any authenticated org
  member (not used by this slice's UI, which resolves rows from the
  already-fetched list, same precedent as Members/Certificates).
- `PATCH /organizations/:orgId/assets/:assetId` — `MANAGE_EVENTS`-gated,
  all fields optional (`UpdateAssetDto`).
- `DELETE /organizations/:orgId/assets/:assetId` — `MANAGE_EVENTS`-gated.

`AssetCondition` enum: `GOOD | DAMAGED | LOST` (Prisma default: `GOOD`).
`Asset` row: `id, organizationId, name, quantity, condition, location:
string | null, notes: string | null, createdByUserId, createdAt,
updatedAt`.

## Route structure

No new routes. `/workspace`'s Assets tab (currently the Slice 9
placeholder "Coming in a later sub-slice") gets real content this slice.

## Components

- **`frontend/types/api.ts`** — add `AssetCondition = 'GOOD' | 'DAMAGED' |
  'LOST'` and the `Asset` interface.
- **`frontend/features/assets/use-assets.ts`** — `useAssets(orgId)`,
  `useCreateAsset(orgId)`, `useUpdateAsset(orgId, assetId)`,
  `useDeleteAsset(orgId)`. Plain JSON `api()` calls (no `apiUpload` — this
  feature has no file involved, unlike Files).
- **`frontend/features/assets/schema.ts`** — `assetFormSchema` (Zod):
  `name` required non-empty, `quantity` positive integer, `condition`
  enum defaulting to `'GOOD'`, `location`/`notes` optional strings. One
  schema, shared by both create and edit (no separate add/edit schema
  split — every field is legal in both modes).
- **`frontend/components/assets/asset-condition-badge.tsx`** — semantic
  status tokens: `GOOD→success`, `DAMAGED→warning`, `LOST→danger`.
  Deliberately *not* a plain outline badge like `FileCategoryBadge` —
  condition is a genuine status signal (good/degraded/gone), matching the
  established semantic-badge family (Event/Registration/Attendance/Member
  status badges), not the "identity, not status" reasoning that applies to
  file category.
- **`frontend/components/assets/asset-dialog.tsx`** — one Dialog handling
  both add and edit via an optional `asset?: Asset` prop: pre-fills from
  `asset` and calls `useUpdateAsset` when present, otherwise starts blank
  (condition defaulted to `GOOD`) and calls `useCreateAsset`. Matches the
  user's explicit choice of modal dialogs over dedicated pages — the field
  set (5 plain inputs, no role/RBAC selection like Members' add/edit) is
  proportionate to a dialog, same weight as Slice 9's `UploadFileDialog`.
- **`frontend/components/assets/asset-list.tsx`** — table: name, quantity,
  condition badge, location, "added by" (resolved name) + relative created
  date. Edit and Remove buttons, committee-only, Remove behind the same
  confirm-`Dialog` pattern used everywhere destructive since Slice 2.
  **"Added by" reuses `useMembers` for name resolution, with the Slice 9
  fix applied from the start, not rediscovered live:** `GET
  /organizations/:orgId/members` is `VIEW_MEMBERS`-gated (committee-only),
  but this asset list is visible to any org member, so the query 403s for
  a non-committee viewer. The row must render `members.isError ?
  'Committee member' : resolveMemberName(...)` — never fall through to a
  raw-id fallback on an authorization failure, exactly the bug fixed in
  Slice 9's `FileList`.
- **`frontend/app/(app)/[orgSlug]/workspace/page.tsx`** — Assets tab
  wired to `AssetList` + an "Add asset" button (committee-only) opening
  `AssetDialog` in create mode, replacing the placeholder text. Files and
  Minutes tabs untouched (Minutes remains its own future sub-slice).

## RBAC & data flow

Same two-tier split as Files (Slice 9): `isCommittee()` (reused from Slice
2, no new tier) gates Add/Edit/Remove, matching backend `MANAGE_EVENTS` on
create/update/remove; list needs no role check, matching the backend's
bare `JwtAuthGuard, TenantGuard` on `GET`/`GET :id`. No pagination —
unpaginated, server-sorted `name asc` (bounded per-org inventory, same
reasoning as Events/File Repository/Meeting Minutes' sibling lists).

## Testing

**Unit (logic only):** `assetFormSchema` validation — name required,
quantity must be a positive integer, condition enum accepts only the three
values, location/notes optional. No component tests (matches every prior
dialog/list component in this app — live-verification only).

**Live verification (dev server + Playwright, real backend):** add an
asset for each condition value, confirm the badge color matches (success/
warning/danger) in both themes; edit an asset (change quantity, change
condition, confirm the badge updates); remove with confirm; a
non-committee account sees the list (name/quantity/condition/location) but
no Add/Edit/Remove controls, and "added by" shows "Committee member" (not
a raw id) for that account — this is the one specific regression to check
given it's a design-time-anticipated repeat of a Slice 9 bug, not a novel
risk.

No backend files expected to be touched — verified the full contract
against `assets.controller.ts`/`assets.service.ts` source before writing
this spec.
