# Frontend Slice 15 — Achievements Management — Design

**Status:** approved, pending implementation.

## Scope

Third and last of three Public Club Page sub-slices (Public Club Page
itself shipped Slice 13; Gallery Management shipped Slice 14). Full
committee-side management UI for the already-shipped
`AchievementsController` (`backend/src/achievements/achievements.controller.ts`):
create, list, update, remove. No new backend endpoints. Completes the
Public Page nav area's second tab, currently a placeholder.

## RBAC

Matches `AchievementsController` exactly:
- `list`/`findOne` — any authenticated org member (no `RolesGuard`).
- `create`/`update`/`remove` — `MANAGE_EVENTS` tier (`isCommittee`).

Same nav-gated-not-route-gated shape as Gallery (Slice 14): the "Public
Page" nav link itself is committee-only, but a non-committee visitor who
navigates directly to the URL sees the Achievements tab read-only (no Add
button, no Edit/Remove controls) rather than a redirect.

## Data layer

`frontend/features/achievements/use-achievements.ts`:
- `useAchievements(orgId)` — `GET /organizations/:orgId/achievements`
  (backend sorts `year desc`, no client-side sort needed).
- `useCreateAchievement(orgId)` — `POST`.
- `useUpdateAchievement(orgId)` — mutate-time `{achievementId, input}`,
  mirroring Slice 10's `useUpdateAsset` exactly.
- `useRemoveAchievement(orgId)` — `DELETE`.

No dedicated single-fetch hook — same reasoning as Assets: the
already-fetched list supplies the edit dialog's defaults, so the
backend's `GET :id` route (which exists) is never called from this
frontend, same as Assets never called it either.

`frontend/features/achievements/schema.ts` — `achievementFormSchema`:
`title` (min 1), `description` (min 1), `year` as a string form field
with regex/refine validation converting to an integer at submit time —
identical pattern to `assetFormSchema`'s `quantity` field.

## Components

- `AchievementDialog` (`frontend/components/achievements/achievement-dialog.tsx`)
  — conditionally-mounted, no `open` prop (`{orgId, achievement?:
  Achievement, onClose}`), same shape as `AssetDialog`. Fields: title
  (`Input`), description (`Textarea`), year (`Input`, numeric). Standard
  `ApiError` inline error display, Cancel/Save footer.
- `AchievementsList` (`frontend/components/achievements/achievements-list.tsx`)
  — renders each achievement (title, year, description) as a row,
  committee-only Edit + Remove buttons per row (Remove uses the standard
  confirm-dialog pattern already established for Files/Assets/Minutes/
  Gallery). Visible to any authenticated member; write controls
  committee-only.

## Page wiring

`frontend/app/(app)/[orgSlug]/public-page/page.tsx`'s Achievements tab
branch replaces the "Coming in a later sub-slice" placeholder text with
`<AchievementsList orgId={org.id} canManage={committee} />` plus an "Add
achievement" button (committee-only, next to the tab switcher when the
Achievements tab is active — mirroring how Workspace's page shows
tab-specific action buttons). Dialog state:
`{mode:'create'} | {mode:'edit', achievement:Achievement} | null`, same
shape as Workspace's `AssetDialogState`.

## Error handling

- Empty list: "No achievements yet." — Add button still renders for
  committee.
- Update/remove errors: standard `ApiError` inline message.
- Non-committee direct-URL access: read-only, no redirect.

## Testing

Unit: `achievementFormSchema` (valid submission; rejects empty title;
rejects empty description; rejects a non-integer year; rejects an empty
year field) — 5 cases. No additional year bound is added on the
frontend: the backend DTO (`@IsInt() year!: number`) has none either, so
the client-side check only mirrors what the backend actually enforces
rather than inventing a stricter rule. No new role-tier helper needed
(reuses `isCommittee`).

Live verification: add an achievement, confirm it appears correctly
sorted (year desc) among any existing ones; edit it (change year and
description), confirm persistence on reload; remove with confirm;
non-committee test account confirms read-only access via direct URL (no
Add button, no Edit/Remove); confirm a newly added achievement appears
on the real `/club/[orgSlug]` public page from Slice 13, closing the
loop and completing verification of all three Public Club Page
sub-slices end-to-end; both themes screenshotted.

No new backend endpoints. Backend test baseline expected unchanged (101
unit / 327 e2e) unless a real defect is found live.
