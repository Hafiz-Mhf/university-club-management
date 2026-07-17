# Branding & Themes — Design Spec

Roadmap Phase 2 ("Organization Workspace"): Branding & Themes. Backend-only.
Upgrades the raw `logoKey`/`primaryColor` fields `Organization` already
carries (set via `PATCH /organizations/:orgId` and `.../settings` as plain
strings, with no upload flow, no validation, no size/type checks) into a
real branding feature: validated logo/banner upload, a second theme color,
and consistent signed-URL resolution across the authenticated and public
surfaces.

## Goal

Let a club's `PRESIDENT`/`VICE_PRESIDENT` upload a logo and banner image
(replacing the current arbitrary-string `logoKey` PATCH) and set a
`primaryColor`/`secondaryColor` pair, with the result rendered consistently
on both the authenticated org view and the existing public club page.

## Scope

**Building this phase:**

1. `POST /organizations/:orgId/logo` and `POST /organizations/:orgId/banner`
   — multipart upload, replacing the previous image at a deterministic
   storage key.
2. `DELETE /organizations/:orgId/logo` and `.../banner` — clear the field
   and remove the stored object.
3. `secondaryColor` added to `Organization` and to
   `UpdateOrganizationSettingsDto`/`updateSettings()`, alongside the
   existing `primaryColor`.
4. `logoKey` removed from `UpdateOrganizationDto`/`updateProfile()` — the
   upload endpoint is now the only way to set it.
5. `OrganizationsService.findOne()` resolves `logoKey`/`bannerKey` to signed
   `logoUrl`/`bannerUrl` (matching what `public.service.ts` already does for
   the public page), instead of returning raw storage keys.
6. `public.service.ts getProfile()` gains `bannerUrl` alongside its existing
   `logoUrl`/`primaryColor`.

**Explicitly not building this phase:**

- Logo/banner counting against the shared org storage quota (the
  `Certificate`/`OrgFile`/`GalleryPhoto` `fileSizeBytes` aggregate) — these
  are single overwritable slots, not an accumulating collection, so a flat
  2MB per-upload cap is enough. No `logoSizeBytes`/`bannerSizeBytes` column,
  no changes to `files.service.ts`/`certificates.service.ts`/`gallery.service.ts`'s
  quota math.
- SVG support (XSS surface from embedded scripts in served-back SVGs) —
  PNG/JPEG/WebP only.
- Preset color palettes / named themes — raw hex fields only, same
  `@Matches(/^#([0-9a-fA-F]{6})$/)` validation `primaryColor` already uses.
- Dark-mode color variants.
- Any frontend theming (CSS custom properties, favicon generation) — this
  phase is the backend data + storage layer only, consistent with every
  other Phase 2 item shipped so far being backend-only.
- Cropping/resizing on upload — stored as-is; any resizing is a frontend or
  future-phase concern.

## Architecture

Extends the existing `backend/src/organizations/` module — no new module,
consistent with "extend the module that owns the resource" (the same call
made for Certificate Generator's `generation/` subfolder). No new BullMQ
queue: upload/delete are synchronous, single-file, low-latency operations,
unlike Certificate Generator's batch fan-out.

```text
organizations/
  organizations.controller.ts   # +4 endpoints: POST/DELETE logo, POST/DELETE banner
  organizations.service.ts      # +uploadLogo/deleteLogo/uploadBanner/deleteBanner,
                                 # findOne() now resolves signed URLs,
                                 # updateSettings() gains secondaryColor
  dto/
    update-organization.dto.ts           # logoKey removed
    update-organization-settings.dto.ts  # +secondaryColor
```

- **Upload** (`uploadLogo`/`uploadBanner`, near-identical bodies — a shared
  private `uploadBrandingImage(organizationId, kind: 'logo' | 'banner',
  file, actorUserId)` helper avoids duplicating the validation+storage+audit
  logic twice):
  1. Validate `file` is present, `mimetype` is one of
     `image/png`/`image/jpeg`/`image/webp`, `size <= 2 * 1024 * 1024` — same
     `BadRequestException` pattern as `CertificatesService.upload()`.
  2. Compute the deterministic key: `branding/${organizationId}/${kind}.${ext}`
     where `ext` is derived from `mimetype` (`png`/`jpg`/`webp`). Unlike
     Certificates (immutable, one row per event+user), this key includes the
     extension, so switching image format (e.g. png → webp) changes the key
     — read the organization's current `logoKey`/`bannerKey` *before* the
     write; if it differs from the new key (extension changed), delete the
     old object *after* the new one is confirmed written, so a failed
     upload never leaves the org logo-less.
  3. `storage.putObject(newKey, file.buffer, file.mimetype)`.
  4. `$transaction`: `organization.update({ [logoKey|bannerKey]: newKey })` +
     `audit.record({ action: 'organization.logo.upload' | 'organization.banner.upload',
     targetType: 'Organization', targetId: organizationId, metadata: { key: newKey } })`.
  5. If the old key existed and differs from the new key,
     `storage.deleteObject(oldKey)` after the transaction commits (best
     effort — a leftover orphaned object on delete failure is not worth
     failing the request over, matches no existing precedent needing
     rollback-on-delete-failure elsewhere in the codebase).
  6. Return `findOne(organizationId)` (resolved signed-URL shape).
- **Delete** (`deleteLogo`/`deleteBanner`): if no key set, no-op (200, not
  404 — deleting an already-absent logo is idempotent, not an error).
  Otherwise `$transaction` clears the field + audits
  `organization.logo.delete`/`organization.banner.delete`, then
  `storage.deleteObject(key)` after commit.
- **`findOne()`** (resolving version):
  ```ts
  async findOne(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return null;
    const { logoKey, bannerKey, ...rest } = org;
    const logoUrl = logoKey ? await this.storage.getSignedDownloadUrl(logoKey, 300) : null;
    const bannerUrl = bannerKey ? await this.storage.getSignedDownloadUrl(bannerKey, 300) : null;
    return { ...rest, logoUrl, bannerUrl };
  }
  ```
  `OrganizationsService` gains a `StorageService` constructor dependency
  (not previously needed).

**Wiring:** `OrganizationsModule` imports `StorageModule` (new dependency).
No changes to `EventsModule`, `NotificationsModule`, or any queue — this
feature has no async component.

## Data model

```prisma
model Organization {
  ...
  primaryColor   String  @default("#2563eb")
  secondaryColor String  @default("#1e293b")   // new
  logoKey        String?                        // existing, upload-only now
  bannerKey      String?                        // new
  ...
}
```

Additive-only migration (two new columns, both with defaults or nullable —
no backfill needed). `TENANT_SCOPED_MODELS` unchanged (`Organization` itself
is the tenant root, not a tenant-scoped child model).

## Endpoints

```
POST   /organizations/:orgId/logo      multipart 'file' — PNG/JPEG/WebP, ≤2MB
DELETE /organizations/:orgId/logo
POST   /organizations/:orgId/banner    multipart 'file' — PNG/JPEG/WebP, ≤2MB
DELETE /organizations/:orgId/banner
PATCH  /organizations/:orgId/settings  body: { primaryColor?, secondaryColor? }
GET    /organizations/:orgId           now returns { ...org, logoUrl, bannerUrl }
                                        (logoKey/bannerKey no longer in the response)
```

`PATCH /organizations/:orgId` (`updateProfile`) drops `logoKey` from its
accepted body — a client sending it is silently ignored (DTO field removed,
`class-validator`'s `whitelist: true` global pipe strips unknown
properties, consistent with existing behavior for any other unrecognized
field).

## RBAC

- Logo/banner upload + delete: `PRESIDENT`, `VICE_PRESIDENT` — matches
  `updateProfile()`'s existing roles (logoKey lived in that DTO before this
  change).
- Settings (`primaryColor`/`secondaryColor`): `PRESIDENT` only — unchanged
  from today.
- `findOne()` (`GET /organizations/:orgId`): unchanged, any authenticated
  member (`JwtAuthGuard` + `TenantGuard`, no `@Roles()`).

## Audit

- `organization.logo.upload` / `organization.logo.delete` (new) —
  `targetType: 'Organization'`, metadata `{ key }` (storage key only, no
  personal data).
- `organization.banner.upload` / `organization.banner.delete` (new) — same
  shape.
- `organization.settings.update` (existing) — metadata's `fields` array now
  can include `secondaryColor`; no structural change.
- No audit row for a no-op delete (key already absent) — matches the
  "audit successful sensitive actions only" precedent.

## Testing plan

**Unit** (`backend/src/organizations/organizations.service.spec.ts`):

- `uploadLogo`/`uploadBanner`: happy path (storage + DB + audit called
  correctly, old key deleted when extension changes, old key *not* deleted
  when it's the same); rejects non-allowlisted MIME type; rejects >2MB;
  rejects missing file.
- `deleteLogo`/`deleteBanner`: happy path (field cleared, storage object
  removed, audit recorded); no-op when key already absent (no storage call,
  no audit row).
- `updateSettings`: `secondaryColor` persists alongside `primaryColor`;
  invalid hex rejected (existing `@Matches` validation, now covering two
  fields).
- `findOne`: returns `logoUrl`/`bannerUrl` (signed) instead of raw keys;
  returns `null` URLs when keys are unset; returns `null` for a
  nonexistent org.

**E2E** (`backend/test/organization-branding.e2e-spec.ts`):

- Upload logo → 201, `GET /organizations/:orgId` reflects a resolved
  `logoUrl` that's fetchable and returns the uploaded bytes.
- Upload banner → same, for `bannerUrl`.
- Re-upload with a different format → old object is gone (fetching the
  previous signed URL's underlying key via `storage.getObject` throws), new
  one is present.
- Reject non-image MIME (400), reject >2MB (400), reject missing file
  (400).
- Non-PRESIDENT/VICE_PRESIDENT member gets 403 on upload/delete.
- Delete logo → `logoUrl` becomes `null`, repeat delete is still 200
  (idempotent), no duplicate audit row on the second call.
- `PATCH .../settings` round-trips `secondaryColor`; invalid hex → 400.
- Tenant isolation: org A's logo/banner/colors untouched by any operation
  scoped to org B's id (`TenantGuard` already covers this at the guard
  level — one confirming test, matching every prior feature's pattern).
- Public page (`GET /public/organizations/:orgId/profile`) reflects
  `bannerUrl` after upload (extends the existing public-club-page e2e
  suite).

**Regression:** existing `organizations` unit/e2e specs referencing
`logoKey` in `PATCH /organizations/:orgId` bodies or response shapes are
updated for its removal from the DTO and `findOne()`'s new resolved shape.

## Out of scope

- Shared storage quota participation for logo/banner.
- SVG support.
- Preset/named color palettes.
- Dark-mode color variants.
- Frontend theming (CSS variables, favicon generation).
- Image cropping/resizing on upload.
