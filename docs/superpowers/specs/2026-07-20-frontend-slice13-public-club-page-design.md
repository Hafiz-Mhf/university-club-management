# Frontend Slice 13 — Public Club Page — Design

**Status:** approved, pending implementation.

## Scope

First of three sub-slices covering the Public Club Page epic (backend
`gallery`, `achievements`, `public` modules — all shipped in Phase 2, zero
frontend so far). Same decomposition pattern as Workspace (Slices 9–11):
one epic, three independent pieces, built one at a time.

1. **Public Club Page (this slice)** — new unauthenticated route showing
   org profile, upcoming events, gallery grid, achievements list.
2. **Gallery management** (future sub-slice) — committee upload/list/remove
   UI, in-app.
3. **Achievements management** (future sub-slice) — committee create/edit/
   remove UI, in-app.

This slice ships the public-facing page only. Until sub-slices 2 and 3
ship, the gallery/achievements sections of the public page will render
empty-state text for any org that hasn't been seeded with data by other
means (e.g. directly via API) — that's expected and honest, not a bug.

## Backend change (small, scoped)

`backend/src/public/public.controller.ts`'s three routes currently key on
`:orgId` (a UUID) — `/public/organizations/:orgId/{profile,gallery,
achievements}`. No frontend or other consumer exists yet, so this is
risk-free to change before anything depends on it:

- Route param renames `:orgId` → `:orgSlug` on all three endpoints.
- `PublicService.requireOrganization` resolves via
  `prisma.organization.findUnique({ where: { slug: orgSlug } })` instead of
  `{ where: { id: organizationId } }`. `Organization.slug` is already
  `@unique` in the schema, so this is a safe swap, not a new constraint.
- Internal service methods (`getGallery`, `getAchievements`,
  `EventsService.listPublicUpcoming`) still take the resolved
  `organizationId` internally — only the public-facing route param and the
  initial lookup change.
- Existing e2e specs updated in place: `backend/test/public-profile.e2e-spec.ts`
  and `backend/test/public-gallery-achievements.e2e-spec.ts` both currently
  build URLs from `orgId` — every such URL changes to use the created org's
  `slug` instead. A new case is added: unknown slug → 404 (mirrors the
  existing "404 for a nonexistent orgId" case, just keyed on slug).

Reason for doing this now rather than shipping `/club/<uuid>` URLs: a
public club page whose only purpose is to be shared and remembered is
undermined by a UUID in the URL — this is a one-line-per-route change, not
new surface area.

## Frontend architecture

New route group, fully outside the authenticated `(app)` tree:

- `frontend/app/club/[orgSlug]/page.tsx` — the public page itself.
- `frontend/app/club/[orgSlug]/layout.tsx` — minimal standalone layout:
  no sidebar, no topbar, no `OrgProvider` (which assumes an authenticated
  membership and would 401/loop for an anonymous visitor). Just a plain
  wrapper applying the light/dark token CSS the rest of the app already
  loads via the root `app/layout.tsx` (root layout is shared; this nested
  layout only skips the `(app)` shell, it doesn't re-implement tokens).

Data layer — `frontend/features/public/use-public-club.ts`:

```typescript
export function usePublicProfile(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'profile'],
    queryFn: () => api<PublicProfile>(`/public/organizations/${orgSlug}/profile`, { auth: false }),
    retry: false,
  });
}

export function usePublicGallery(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'gallery'],
    queryFn: () => api<PublicGalleryPhoto[]>(`/public/organizations/${orgSlug}/gallery`, { auth: false }),
  });
}

export function usePublicAchievements(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'achievements'],
    queryFn: () => api<PublicAchievement[]>(`/public/organizations/${orgSlug}/achievements`, { auth: false }),
  });
}
```

`auth: false` already exists on `ApiOptions` (used today by
`/auth/login`/`/auth/register`) — this is its first reuse for a GET, not
new client capability. `retry: false` on the profile query mirrors the
existing "404 is meaningful" precedent (`useMinutes`, `useMyCertificate`)
since an unknown slug should show a real not-found state, not retry.

New types in `frontend/types/api.ts`:

```typescript
export interface PublicProfile {
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string | null;
  socialLinks: Record<string, string> | null;
  advisors: string[] | null;
  upcomingEvents: { id: string; title: string; startAt: string; endAt: string; venue: string | null }[];
}

export interface PublicGalleryPhoto {
  id: string;
  caption: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface PublicAchievement {
  id: string;
  title: string;
  description: string;
  year: number;
}
```

## Page layout (top to bottom)

1. **Hero** — banner image full-width (or a plain neutral fallback block
   if `bannerUrl` is null), logo overlapping the bottom edge (or a
   placeholder icon), org name, description, social links rendered as a
   row of labeled links (using the `socialLinks` record's keys as labels —
   same free-form assumption as Slice 12's editor, no fixed platform set),
   advisors as a plain bulleted list.
2. **Upcoming events** — simple cards (title, formatted date range,
   venue), reusing the existing `Intl.DateTimeFormat` per-file-constant
   pattern. Section header always renders; empty state is "No upcoming
   events" text rather than omitting the section — matches every other
   empty-state in this app ("don't hide, explain").
3. **Gallery** — responsive CSS grid of thumbnails (`downloadUrl` used
   directly as `<img src>`, no separate thumbnail size — backend doesn't
   generate one). Each photo is an `<a target="_blank">` wrapping the
   image, linking to the same signed URL. Empty state: "No photos yet."
4. **Achievements** — list ordered exactly as the backend returns
   (`year desc`), each entry showing title, year, description. Empty
   state: "No achievements yet."

## Settings integration

`frontend/components/orgs/organization-tab.tsx` (Slice 12) gains a small
"View public page" section: a link styled as a button
(`buttonVariants()` + `target="_blank"`, matching the existing
link-styled-as-button precedent) pointing at
`${window.location.origin}/club/${org.slug}`, plus a "Copy link" button
using `navigator.clipboard.writeText`. This section renders for every
committee viewer regardless of `canManageOrgProfile`/`canManageOrgColors`
— viewing/sharing the public URL isn't a mutation, so it isn't gated by
either edit tier, only by the tab's existing committee-only visibility.

## Error handling

- Unknown slug: `PublicProfile` query 404s, page renders a plain
  "Club not found" state (no redirect target exists for an anonymous
  visitor — there's nothing to redirect *to*).
- Gallery/achievements queries failing independently of profile (e.g.
  profile succeeds, gallery 500s): each section handles its own
  `isError` independently, showing "Couldn't load photos"/"Couldn't load
  achievements" rather than failing the whole page — the three are
  already independent queries, so this costs nothing extra.
- No PDPA/consent concern: this page shows only committee-authored public
  content (org name/description/branding, photos, achievements) —
  confirmed by reading `PublicService`, which never selects member PII.

## Testing

- Backend: update both existing e2e specs to build URLs from the created
  org's `slug` instead of `id`; add one new case (unknown slug → 404) to
  `public-profile.e2e-spec.ts`.
- Frontend: this page is presentational/read-only with no form schemas or
  branching business logic, so unit-test surface is minimal — no
  dedicated test file is planned unless a real helper function (e.g. a
  social-links-to-rendered-list mapper) turns out to need one during
  implementation.
- Live verification: the primary check. Load `/club/<real-slug>` in a
  **logged-out** browser context (no auth token at all, not just a
  different role) — the first frontend surface in this app that must work
  with zero authentication, so this is the one live-verification pass
  where "already logged in as some account" would silently invalidate the
  test. Confirm profile/events/gallery/achievements all render from real
  data, confirm the unknown-slug not-found state, confirm the Settings
  "View public page"/"Copy link" additions work and the copied URL
  actually loads the right org, both themes screenshotted.

No new backend endpoints (only a param rename on three existing ones).
Backend test baseline expected: 101 unit / 327 e2e, with the two e2e spec
files modified in place (test count may shift by +1 for the new
unknown-slug case) rather than unchanged — a genuine, if small, exception
to nearly every prior frontend slice's "backend untouched" pattern (only
Slice 6 has touched backend before this).
