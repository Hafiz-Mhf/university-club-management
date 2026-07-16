# Asset Management — Design Spec

Roadmap Phase 2, item 4 ("Organization Workspace"). Backend-only (no
frontend exists yet in this project — same posture as every prior phase
item). A static inventory of club-owned assets: what the club has, how
many, and what condition it's in.

## Goal

Give committee members a simple inventory list of physical club assets
(equipment, furniture, supplies) — quantity-per-type, condition, location,
notes. Matches the roadmap's literal wording ("inventory of club assets"),
not a lending-library or equipment-checkout system.

## Scope

One new model (`Asset`), one new module (`AssetsModule`). Standalone,
org-level, quantity-per-type rows (one row per asset *type*, e.g. "Folding
Chairs" with `quantity: 20`, not one row per physical chair). Full CRUD:
committee-tier roles manage the inventory, any ACTIVE member can view it.

**Explicitly not building this phase:**
- Checkout/return tracking (who currently has item X, due dates) — this is
  an inventory, not a lending system. A borrow/return workflow is a
  different feature with different requirements (due dates, overdue
  notifications) not called for by the roadmap line.
- Individual-unit tracking (serial numbers, one row per physical item) —
  club-scale gear (chairs, cables, banners) is bought and tracked in bulk;
  individual tracking is data-entry overhead with no clear payoff at this
  scale.
- Purchase/financial fields (cost, purchase date) — overlaps a future
  Phase 3 "Budget & Sponsor Management" item not yet specced. Adding
  financial tracking here would duplicate that concern before it exists.

## Data model

```prisma
enum AssetCondition {
  GOOD
  DAMAGED
  LOST
}

model Asset {
  id              String         @id @default(uuid())
  organizationId  String
  organization    Organization   @relation(fields: [organizationId], references: [id])
  name            String
  quantity        Int
  condition       AssetCondition @default(GOOD)
  location        String?
  notes           String?
  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([organizationId])
}
```

- `quantity`: total count of this asset type owned, must be ≥ 1 (an asset
  row with zero units on hand should be deleted, not zeroed out — there's
  no "0 quantity but still tracked" use case this phase).
- `condition`: defaults to `GOOD` at creation if omitted. Three states
  cover the practical cases a club cares about — usable, needs
  repair/replacement, gone. No `RETIRED`/`FAIR` granularity this phase.
- `location`: optional free text (e.g. "Storage Room B", "Committee
  Office") — no fixed enum, since clubs' storage setups vary too widely
  to standardize a location list.
- `notes`: optional free text for anything else worth recording.
- `createdByUserId`: plain column, no FK relation, matching
  `OrgFile.uploadedByUserId`'s and `MeetingMinutes.createdByUserId`'s
  convention.

`Asset` **is** added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts` — the list endpoint issues
a genuine org-scoped `findMany`, same reasoning as `OrgFile` and
`MeetingMinutes`.

## Endpoints

All routes live under a new `AssetsModule` (`backend/src/assets/`),
mirroring `MinutesModule`'s CRUD shape (`assets.module.ts`,
`assets.controller.ts`, `assets.service.ts`, `dto/`).

`@Controller('organizations/:orgId/assets')`

1. `POST /organizations/:orgId/assets` — create.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - Body: `name` (string, required), `quantity` (int, required, ≥ 1),
     `condition` (`AssetCondition`, optional — defaults `GOOD`), `location`
     (string, optional), `notes` (string, optional).
   - Writes the `Asset` row + `AuditLog` (`asset.create`) atomically.

2. `GET /organizations/:orgId/assets` — list.
   - Guard: `JwtAuthGuard, TenantGuard` only. Any ACTIVE member.
   - Returns a plain array (no pagination) — an inventory is a bounded
     list of item *types* (a club has dozens of asset types at most, not
     thousands), unlike Meeting Minutes' unbounded meeting archive. This
     matches Certificates'/Events' unpaginated `list()` precedent rather
     than Audit Logs'/Meeting Minutes' paginated one.
   - Sorted `name asc` (alphabetical, since there's no natural time-based
     ordering for a static inventory the way there is for events or
     minutes).

3. `GET /organizations/:orgId/assets/:assetId` — get one.
   - Guard: `JwtAuthGuard, TenantGuard` only. Any ACTIVE member.
   - `404` if `assetId` doesn't belong to this org.

4. `PATCH /organizations/:orgId/assets/:assetId` — edit.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - Body: any subset of `name`, `quantity`, `condition`, `location`, `notes`.
   - `404` if `assetId` doesn't belong to this org.
   - Writes the update + `AuditLog` (`asset.update`) atomically.

5. `DELETE /organizations/:orgId/assets/:assetId` — delete.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - `404` if `assetId` doesn't belong to this org.
   - Writes the delete + `AuditLog` (`asset.delete`) atomically.

## Validation

- `name`: required, non-empty string.
- `quantity`: required, integer ≥ 1.
- `condition`: optional, must be one of `GOOD`/`DAMAGED`/`LOST` if
  provided; defaults to `GOOD` when omitted at creation.
- `location`, `notes`: optional strings, no length constraint beyond what
  the database column allows.

Any validation failure → `400 BadRequestException`.

## RBAC

| Action | Roles |
|--------|-------|
| Create | `MANAGE_EVENTS` |
| List | Any ACTIVE member of the org (all roles) |
| Get one | Any ACTIVE member of the org |
| Edit | `MANAGE_EVENTS` |
| Delete | `MANAGE_EVENTS` |

Same guard-chain convention as every other multi-route controller
(`@UseGuards`/`@Roles` repeated per-method, not hoisted to class level).
Same tier split as File Repository and Meeting Minutes — committee
manages, whole club views.

## Audit

Three new audit actions, matching `event.create`/`event.update`/
`event.delete`'s exact shape:

- `asset.create` — `targetType: 'Asset'`, `targetId: asset.id`, metadata
  `{ assetId, name, quantity }`.
- `asset.update` — same shape, metadata `{ assetId, fields }` (names of
  updated fields, matching `event.update`'s pattern).
- `asset.delete` — same shape, metadata `{ assetId, name }`.

Reads (list, get-one) are unaudited — matches the established precedent.

## Error handling

- Wrong org → `403` (`TenantGuard`, no membership) on every route.
- Non-committee caller on create/edit/delete → `403` (`RolesGuard`).
- Missing/empty `name`, `quantity` < 1, invalid `condition` value → `400`.
- `assetId` not found in this org (get-one, edit, delete) → `404`.

## Testing plan

**E2E only** (`backend/test/assets-*.e2e-spec.ts`), no unit-test file —
same precedent as `MinutesService`/`FilesService`.

- **Create:** committee member creates an asset with all fields → `201`,
  row matches input; creating with only required fields → `condition`
  defaults to `GOOD`; a plain participant attempting create → `403`;
  missing `name` → `400`; `quantity` of `0` → `400`.
- **List:** returns assets sorted alphabetically by `name`; a plain
  participant can list (no RBAC restriction); cross-org isolation — org
  B's president cannot list org A's assets (`403`).
- **Get one:** returns the full entry; `404` for an `assetId` from a
  different org.
- **Edit:** updates a subset of fields, leaves others untouched; a plain
  participant attempting edit → `403`; `404` for an `assetId` from a
  different org.
- **Delete:** committee member deletes an asset → subsequent get-one →
  `404`; a plain participant attempting delete → `403`; `404` for an
  `assetId` from a different org.

## Out of scope

- Checkout/return (lending) workflow.
- Individual-unit/serial-number tracking.
- Purchase cost/date fields — deferred to a future budget-management item.
- Pagination on list — inventory is bounded, unlike Meeting Minutes' archive.
- Category/type grouping — a plain flat list, one row per asset name, this
  phase.
