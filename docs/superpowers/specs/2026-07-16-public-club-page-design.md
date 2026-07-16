# Public Club Page — Design Spec

Roadmap Phase 2, item 5 ("Organization Workspace"). Backend-only (no
frontend exists yet in this project — same posture as every prior phase
item). **The first genuinely unauthenticated surface in this codebase** —
every prior endpoint, across every phase, has required at least a valid
JWT and org membership.

## Goal

Give each club a public-facing profile: upcoming events, a photo gallery,
contacts, achievements, and links a visitor can follow to register for an
event (after signing up/logging in — this does not add anonymous
registration). Three sub-parts ship together in one spec since each is
small: (1) a public read-only profile/gallery/achievements surface, (2) a
new Gallery feature, (3) a new Achievements feature.

## Scope

**In scope:**
- `GalleryModule` — committee-managed photo uploads with captions,
  reusing the org's shared storage quota.
- `AchievementsModule` — committee-managed award/recognition records
  (title, description, year).
- `PublicModule` — three unauthenticated `GET` routes exposing org
  profile info, upcoming published events, gallery photos, and
  achievements to anyone, no login required.

**Explicitly not building this phase:**
- Anonymous/unauthenticated event registration. "Public registration
  links" means a visitor can discover and follow a link to a specific
  event; actually registering still requires signup/login, exactly like
  every existing registration flow (which is built around an
  authenticated `User` + PDPA consent capture end to end — bypassing that
  is a different, much larger feature, not this one).
- Logo/banner **upload**. `Organization.logoKey` already exists as a
  field (set only via a raw string in `UpdateOrganizationDto` today — no
  upload endpoint exists anywhere in the codebase). The public profile
  endpoint reads `logoKey` if present and serves it as a signed URL, but
  building an actual upload flow for it is "Branding & Themes" (a
  separate, not-yet-specced roadmap item) — out of scope here.
- Dedicated contact fields. Reuses `Organization.socialLinks`/`advisors`
  (both already exist as `Json?` from Phase 1) rather than adding new
  columns.
- Gallery photo editing (caption changes) — delete + re-upload only, same
  precedent as `Certificate`.
- A public bucket / static public storage paths. Gallery images stay in
  the same private bucket as every other upload; the public route mints a
  fresh signed URL per request. This satisfies CLAUDE.md's "files are
  private, no public storage paths" rule literally, while still making
  the *page* genuinely public — the distinction is between "the storage"
  (stays private) and "the route serving it" (has no auth requirement).

## Data model

```prisma
model GalleryPhoto {
  id               String       @id @default(uuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id])
  storageKey       String
  caption          String?
  uploadedByUserId String
  createdAt        DateTime     @default(now())

  @@index([organizationId])
}

model Achievement {
  id              String       @id @default(uuid())
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id])
  title           String
  description     String
  year            Int
  createdByUserId String
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId])
}
```

- `GalleryPhoto.storageKey`: `gallery/{organizationId}/{randomUUID()}.{ext}`
  — unique per upload, same convention as `OrgFile.storageKey`.
- Both models are added to `TENANT_SCOPED_MODELS` — their committee-facing
  list endpoints issue genuine org-scoped `findMany` calls.
- No schema change to `Organization` — the public profile reuses
  `name`, `description`, `logoKey`, `primaryColor`, `socialLinks`,
  `advisors`, all of which already exist.

## Endpoints

### Committee-facing: Gallery (`backend/src/gallery/`)

`@Controller('organizations/:orgId/gallery')`

1. `POST /organizations/:orgId/gallery` — upload. `MANAGE_EVENTS`.
   `multipart/form-data`: `file` (required) + `caption` (optional
   string). Validates MIME (`image/png`, `image/jpeg` only), size ≤ 10MB,
   and the org's shared storage quota (summed across `Certificate` +
   `OrgFile` + `GalleryPhoto` — same pattern File Repository established
   for `Certificate` + `OrgFile`, now extended to a third table). Audited
   `gallery.upload`.
2. `GET /organizations/:orgId/gallery` — list. Any ACTIVE member. Returns
   `Array<{ id, caption, downloadUrl, createdAt }>` — **a signed URL is
   included per photo in the list response itself**, unlike File
   Repository's list (metadata-only, download separate). A gallery exists
   to be rendered as a grid of images; forcing a caller to make N
   follow-up requests just to display N thumbnails would defeat the
   feature's purpose. This is the one deliberate deviation from the
   File Repository list/download split, and it's justified by the
   different consumption pattern (render-all vs. browse-then-fetch-one).
3. `DELETE /organizations/:orgId/gallery/:photoId` — delete.
   `MANAGE_EVENTS`. DB-first + audit (`gallery.delete`), then storage
   delete — same ordering as `OrgFile`'s delete. `404` if not in this org.

No `PATCH`/edit route — caption changes are delete + re-upload.

### Committee-facing: Achievements (`backend/src/achievements/`)

`@Controller('organizations/:orgId/achievements')` — full CRUD, identical
shape to Asset Management:

1. `POST` — create. `MANAGE_EVENTS`. Body: `title`, `description`, `year`
   (all required). Audited `achievement.create`.
2. `GET` — list. Any ACTIVE member. Unpaginated (bounded — a club has a
   handful of achievements, not thousands), sorted `year desc`.
3. `GET /:achievementId` — get one. Any ACTIVE member. `404` if foreign.
4. `PATCH /:achievementId` — edit. `MANAGE_EVENTS`. Partial update.
   Audited `achievement.update`.
5. `DELETE /:achievementId` — delete. `MANAGE_EVENTS`. Audited
   `achievement.delete`.

### Public (`backend/src/public/`)

`@Controller('public/organizations/:orgId')` — **no guards on any route.**
Every method's first step is an explicit existence check
(`this.prisma.organization.findUnique({ where: { id: orgId } })`) since
there is no `TenantGuard` to catch a bad `orgId` anymore; a missing org
→ `404`.

1. `GET /public/organizations/:orgId/profile` — returns:
   ```ts
   {
     name: string;
     description: string | null;
     logoUrl: string | null;       // signed URL if logoKey is set, else null
     primaryColor: string;
     socialLinks: unknown | null;  // as-stored Json, opaque passthrough
     advisors: unknown | null;     // as-stored Json, opaque passthrough
     upcomingEvents: Array<{ id, title, startAt, endAt, venue }>;
   }
   ```
   `upcomingEvents` comes from a new `EventsService.listPublicUpcoming(organizationId)`:
   `status: 'PUBLISHED'`, `startAt: { gte: new Date() }`, sorted
   `startAt asc`. This response is a fixed allowlist — never
   `storageQuotaMb`, `settings`, or any other `Organization` column not
   named above.
2. `GET /public/organizations/:orgId/gallery` — same response shape as
   the committee gallery list (`Array<{ id, caption, downloadUrl,
   createdAt }>`), reusing `GalleryService.list`.
3. `GET /public/organizations/:orgId/achievements` — same response shape
   as the committee achievements list, reusing `AchievementsService.list`.

## Validation

- Gallery: `file` required; MIME must be `image/png` or `image/jpeg`;
  size ≤ 10MB (interceptor ceiling 15MB, mirroring the
  interceptor-vs-service-check gap pattern from Certificates/Files);
  `caption` optional string.
- Achievements: `title` required non-empty string; `description` required
  non-empty string; `year` required integer (no range bound — YAGNI).

Any validation failure → `400 BadRequestException`.

## RBAC

| Route | Roles |
|-------|-------|
| Gallery upload/delete | `MANAGE_EVENTS` |
| Gallery list/single-download | Any ACTIVE member |
| Achievement create/edit/delete | `MANAGE_EVENTS` |
| Achievement list/get | Any ACTIVE member |
| All three `/public/*` routes | **No auth — open to the internet** |

## Audit

Five new audit actions:

- `gallery.upload` — `targetType: 'GalleryPhoto'`, metadata `{ photoId, caption }`.
- `gallery.delete` — same shape.
- `achievement.create` / `achievement.update` / `achievement.delete` —
  `targetType: 'Achievement'`, matching `event.create`/`event.update`/
  `event.delete`'s shape.

Public reads are unaudited — there is no authenticated actor to
attribute them to, consistent with every other unaudited read in this
codebase (just with the reason made explicit: anonymous traffic has no
`actorUserId` to log against).

## Error handling

- Committee routes: wrong org → `403` (`TenantGuard`); non-committee
  caller on writes → `403` (`RolesGuard`); unknown MIME/oversized
  file/quota exceeded → `400`; unknown `photoId`/`achievementId` in this
  org → `404`.
- Public routes: unknown `orgId` → `404` (explicit check, no guard to
  rely on). No other auth-related error path exists — these routes never
  return `401`/`403`.

## Testing plan

**E2E only**, no unit-test file — same precedent as every sibling
service this phase family.

- **Gallery:** upload success (caption + downloadUrl round-trips real
  bytes) + RBAC 403 + unsupported MIME 400 + oversized 400 + quota-exceeded
  400 (summed across Certificate/OrgFile/GalleryPhoto); list includes
  working signed URLs for every photo; delete + 404-on-subsequent-download
  + RBAC 403 + cross-org 404.
- **Achievements:** create success + RBAC 403 + missing-field 400; list
  sorted `year desc` + plain participant can list; get-one 404 foreign
  org; edit updates subset + RBAC 403 + 404 foreign org; delete +
  404-after + RBAC 403 + 404 foreign org.
- **Public:** each of the three routes, called with **no `Authorization`
  header at all**, returns `200` with the documented shape (profile
  includes `upcomingEvents` reflecting only `PUBLISHED` + future events,
  excluding `DRAFT`/`COMPLETED`/`CANCELLED`; gallery/achievements mirror
  their committee-side counterparts); `404` for a nonexistent `orgId` on
  all three routes; profile response never contains `storageQuotaMb` or
  `settings` keys (explicit negative assertion).

## Out of scope

- Anonymous event registration.
- Logo/banner upload flow (Branding & Themes, later item).
- Dedicated contact-info fields (reuses existing `socialLinks`/`advisors`).
- Gallery photo editing — delete + re-upload only.
- Pagination on gallery/achievements lists — bounded, club-scale data.
- A public storage bucket — signed URLs from the existing private bucket
  only.
