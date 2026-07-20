# Frontend Slice 12 — Settings — Design

**Status:** approved, pending implementation.

## Scope

Last unscoped nav placeholder in the frontend. Covers three already-shipped,
read-only-until-now backend surfaces, none of which need new backend
endpoints:

1. **Org profile** — `PATCH /organizations/:orgId` (name, description,
   socialLinks, advisors). PRESIDENT + VICE_PRESIDENT.
2. **Org branding** — `PATCH /organizations/:orgId/settings` (primaryColor,
   secondaryColor, PRESIDENT only) and logo/banner upload+delete
   (`POST`/`DELETE /organizations/:orgId/logo|banner`, PRESIDENT +
   VICE_PRESIDENT).
3. **My Account (PDPA)** — `GET /me/consents`, `GET /me/export`,
   `DELETE /me`. Cross-org, every authenticated user, no committee gate.
   No change-password endpoint exists in this backend — out of scope.

Scoped as **one combined slice**, not split like Workspace — each half is
smaller than any single Workspace sub-slice was (~5-6 tasks Organization,
~3-4 tasks My Account).

## Nav change

`frontend/components/shell/nav-items.ts:37` — Settings' `minTier` changes
from `'committee'` to `'member'`. Reason: My Account (PDPA export/delete)
applies to every member today via direct API access with zero frontend
gate; hiding the nav link from non-committee members would be a real access
regression, not a simplification.

## Page structure

`/settings` becomes a local-state tabbed page (same pattern as Workspace):

- **Organization** tab — rendered only when `committee` is true. Omitted
  entirely (not shown-disabled) for non-committee viewers, same precedent
  as Slice 2's status-filter omission (don't show a control that can never
  do anything for this viewer).
- **My Account** tab — always rendered, no role gate.

Default active tab: `'organization'` for committee viewers, `'account'`
for everyone else.

## Data layer

- `frontend/features/organizations/use-organization.ts`:
  - `useOrganization(orgId)` — plain `useQuery` keyed `['org', orgId]`
    against `GET /organizations/:orgId`, used as the source of current
    values for both forms on the Organization tab.
  - `useUpdateOrgProfile(orgId)` — `PATCH /organizations/:orgId`.
  - `useUpdateOrgSettings(orgId)` — `PATCH /organizations/:orgId/settings`.
  - `useUploadLogo(orgId)` / `useDeleteLogo(orgId)` — multipart, reuses
    Slice 6's `apiUpload` helper.
  - `useUploadBanner(orgId)` / `useDeleteBanner(orgId)` — same shape.
  - All five mutations invalidate `['org', orgId]` on success so the
    org-context provider picks up new branding/profile immediately.

- `frontend/features/organizations/schema.ts`:
  - `orgProfileSchema` — `{ name: string (min 2), description: string,
    socialLinks: { key: string; value: string }[], advisors: { name:
    string }[] }`. Submit maps the two arrays back to
    `Record<string,string>` / `string[]` for the API call.
  - `orgColorSchema` — `{ primaryColor: string; secondaryColor: string }`,
    each validated against `/^#([0-9a-fA-F]{6})$/` client-side, mirroring
    the backend's `@Matches`.

- `frontend/features/pdpa/use-pdpa.ts`:
  - `useConsents()` — `GET /me/consents`.
  - `useExportData()` — mutation wrapping `GET /me/export`; `onSuccess`
    builds a `Blob` from the JSON response and triggers a download named
    `my-data-export-<YYYY-MM-DD>.json` via a transient `<a>` element.
  - `useDeleteAccount()` — mutation wrapping `DELETE /me`.

## Components

- `frontend/components/organizations/social-links-fields.tsx` —
  `useFieldArray`-backed repeatable key/value rows (add/remove), same shape
  as Slice 11's agenda-items editor.
- `frontend/components/organizations/advisors-fields.tsx` —
  `useFieldArray`-backed repeatable single-text rows.
- `frontend/components/organizations/branding-panel.tsx` — logo + banner
  each get: preview (image if set, placeholder icon if not), inline
  "Upload" (native `<input type="file">`, no dialog) and "Remove" buttons.
  Client-side validates MIME (`image/png|jpeg|webp`) and 2MB max before the
  request, mirroring `validateUploadFile`/`validateCertificateFile`.
- `frontend/components/organizations/color-fields.tsx` — two hex text
  inputs. Enabled for PRESIDENT; `disabled` + "President only" hint text
  for everyone else (including VP, who can edit the rest of the tab).
- `frontend/components/account/consent-history.tsx` — read-only list
  (purpose / policy version / granted date) from `useConsents()`. No
  renew-consent action here — that flow already exists as the login-time
  consent-gate interstitial from Slice 1.
- `frontend/components/account/export-data-button.tsx` — wraps
  `useExportData()`.
- `frontend/components/account/delete-account-dialog.tsx` — explains the
  consequence (irreversible, anonymizes account, revokes sessions across
  every org), requires typing `DELETE MY ACCOUNT` (exact, case-sensitive)
  to enable the confirm button — stronger than this app's usual plain
  confirm-dialog pattern, justified because this is the only
  account-level/cross-org/irreversible action in the app. On success:
  clear the auth store and redirect to `/login`. On a 409 (sole-active-
  president guard), show the backend's message verbatim inline in the
  dialog (e.g. `"Transfer presidency in <org> before deleting your
  account"`) and keep the dialog open — no invented copy, the backend
  message is already specific and actionable.

## RBAC summary

| Action | Tier |
|---|---|
| View Organization tab at all | committee |
| Edit profile (name/desc/socialLinks/advisors) | PRESIDENT, VICE_PRESIDENT |
| Upload/delete logo, banner | PRESIDENT, VICE_PRESIDENT |
| Edit colors | PRESIDENT only |
| View/use My Account tab | everyone (no gate) |

Two independent forms on the Organization tab (profile+socialLinks+advisors
vs. colors), not one combined form — they hit different endpoints and have
different RBAC tiers.

## Error handling

- Branding upload 400s (bad MIME, oversized) surfaced inline via the
  existing `ApiError` message-extraction pattern, not a toast.
- Delete-account 409 shown inline in the dialog (see above), dialog stays
  open.
- Non-committee member visiting `/settings` directly: renders normally with
  only the My Account tab — no redirect, no placeholder (this route is no
  longer a placeholder for anyone).

## Testing

Unit: `orgProfileSchema`/`orgColorSchema` validation cases, `canManageOrg`
(PRESIDENT+VP) / `canManageColors` (PRESIDENT-only) truth tables,
delete-account confirm-text exact-match matcher.

Live verification (dev server + Playwright, against the real backend):
profile edit round-trip; socialLinks/advisors add/remove/save; logo+banner
upload and remove for both allowed MIME types; color edit as PRESIDENT and
disabled-view confirmed as VP; non-committee test account sees only My
Account tab; export button produces a real file download; consent history
renders real rows; delete-account correctly blocked with the sole-president
409 using a test account that is sole PRESIDENT of an org; both themes
screenshotted clean.

No new backend endpoints. Backend test baseline expected unchanged (101
unit / 327 e2e) unless a real defect is found live, per this project's
established pattern.
