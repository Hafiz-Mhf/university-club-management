# Frontend Slice 13 (Public Club Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first of three Public Club Page sub-slices — a new unauthenticated `/club/[orgSlug]` route showing org profile, upcoming events, gallery, and achievements, backed by a small orgId→orgSlug rename on the existing public API.

**Architecture:** Backend `PublicController`/`PublicService` swap their `:orgId` route param for `:orgSlug`, resolving via the org's unique slug instead of its id (zero consumers exist yet, so zero breaking risk). Frontend adds a route group fully outside the authenticated `(app)` tree — no sidebar, no `OrgProvider`, three independent anonymous `useQuery` calls. Settings gains a small "View public page" link.

**Tech Stack:** NestJS, Prisma, Next.js App Router, TanStack Query.

## Global Constraints

- Frontend test baseline going in: **145/145**. Backend baseline: **101 unit / 327 e2e** (7 of the e2e tests live in `public-profile.e2e-spec.ts` and `public-gallery-achievements.e2e-spec.ts`, both modified by Task 1 — the total stays 327, no test is added or removed, only their URLs and one assertion string change).
- `Organization.slug` is `@unique` in `backend/prisma/schema.prisma` — safe to resolve on directly, no new constraint needed.
- Public routes stay unguarded (no `JwtAuthGuard`/`TenantGuard`/`RolesGuard`) — this plan does not add any guard to them.
- `api()`'s existing `auth: false` option (already used by `/auth/login`/`/auth/register` in `frontend/lib/api.ts`) is reused as-is for the three new public GET calls — no change to `frontend/lib/api.ts` itself.
- Next.js dynamic route params are async in this app (`params: Promise<{ ... }>`, unwrapped via React's `use()`) — every prior dynamic page in this codebase follows this shape (e.g. `frontend/app/(app)/[orgSlug]/workspace/minutes/[minutesId]/page.tsx`); the new `/club/[orgSlug]/page.tsx` follows it too.
- No dedicated `layout.tsx` is added for `/club/[orgSlug]` — the route sits outside `(app)`, so it never passes through `AppLayout`'s auth guard or the org-scoped sidebar shell; the root `app/layout.tsx` (fonts, theme-init script, `QueryProvider`, `globals.css`) already applies to every route including this one. Introducing an empty pass-through layout file would add nothing.

---

### Task 1: Backend — orgSlug rename on public routes

**Files:**
- Modify: `backend/src/public/public.controller.ts`
- Modify: `backend/src/public/public.service.ts`
- Modify: `backend/test/public-profile.e2e-spec.ts`
- Modify: `backend/test/public-gallery-achievements.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /public/organizations/:orgSlug/profile`, `GET /public/organizations/:orgSlug/gallery`, `GET /public/organizations/:orgSlug/achievements` (all replacing the old `:orgId`-keyed routes — no consumer exists yet, so this is a pure rename, not a new endpoint alongside the old one).

- [ ] **Step 1: Rewrite `PublicController` to use `orgSlug`**

Replace the full contents of `backend/src/public/public.controller.ts`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

// Intentionally unguarded: these routes are the platform's public surface.
// orgSlug comes straight from the route param (no TenantGuard to populate
// req.organizationId); PublicService validates it exists.
@Controller('public/organizations/:orgSlug')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('profile')
  getProfile(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getProfile(orgSlug);
  }

  @Get('gallery')
  getGallery(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getGallery(orgSlug);
  }

  @Get('achievements')
  getAchievements(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getAchievements(orgSlug);
  }
}
```

- [ ] **Step 2: Rewrite `PublicService` to resolve by slug**

Replace the full contents of `backend/src/public/public.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EventsService } from '../events/events.service';
import { GalleryService } from '../gallery/gallery.service';
import { AchievementsService } from '../achievements/achievements.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly gallery: GalleryService,
    private readonly achievements: AchievementsService,
  ) {}

  // No TenantGuard on public routes — this explicit existence check is the
  // only thing standing between a bad slug and an empty-but-200 response.
  private async requireOrganizationBySlug(slug: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true, description: true, logoKey: true, bannerKey: true, primaryColor: true, socialLinks: true, advisors: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async getProfile(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    const logoUrl = organization.logoKey
      ? await this.storage.getSignedDownloadUrl(organization.logoKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const bannerUrl = organization.bannerKey
      ? await this.storage.getSignedDownloadUrl(organization.bannerKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const upcomingEvents = await this.events.listPublicUpcoming(organization.id);
    return {
      name: organization.name,
      description: organization.description,
      logoUrl,
      bannerUrl,
      primaryColor: organization.primaryColor,
      socialLinks: organization.socialLinks,
      advisors: organization.advisors,
      upcomingEvents,
    };
  }

  async getGallery(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    return this.gallery.list(organization.id);
  }

  async getAchievements(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    return this.achievements.list(organization.id);
  }
}
```

- [ ] **Step 3: Update `public-profile.e2e-spec.ts` to key public routes on slug**

The file already creates the org with a known slug (`` `pub-${Date.now()}` ``) but only captures the returned `id`. Add a variable to hold the slug too, and repoint the three `/public/organizations/...` calls at it. Replace the full contents of `backend/test/public-profile.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public profile (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let orgSlug: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`pub-${Date.now()}@test.io`);
    orgSlug = `pub-${Date.now()}`;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubOrg', slug: orgSlug })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('returns the profile with no Authorization header at all', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Draft Event', startAt: future(5), endAt: future(6) }).expect(201);

    const publishedEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Published Event', startAt: future(10), endAt: future(11) }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${publishedEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/profile`)
      .expect(200);
    expect(res.body.name).toBe('PubOrg');
    expect(res.body.primaryColor).toBe('#2563eb');
    const titles = res.body.upcomingEvents.map((e: { title: string }) => e.title);
    expect(titles).toContain('Published Event');
    expect(titles).not.toContain('Draft Event');
    expect(res.body.storageQuotaMb).toBeUndefined();
    expect(res.body.settings).toBeUndefined();
  });

  it('reflects a fetchable bannerUrl after the committee uploads one', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/banner`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'banner.png', contentType: 'image/png' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/profile`)
      .expect(200);
    expect(res.body.bannerUrl).toBeTruthy();
    const fetched = await fetch(res.body.bannerUrl);
    expect(fetched.status).toBe(200);
  });

  it('404 for a nonexistent slug', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/this-slug-does-not-exist/profile')
      .expect(404);
  });
});
```

- [ ] **Step 4: Update `public-gallery-achievements.e2e-spec.ts` the same way**

Replace the full contents of `backend/test/public-gallery-achievements.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public gallery + achievements (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let orgSlug: string;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`pubga-${Date.now()}@test.io`);
    orgSlug = `pubga-${Date.now()}`;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubGaOrg', slug: orgSlug })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('public gallery route returns photos with no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', 'Public Photo')
      .attach('file', pngBytes(), { filename: 'p.png', contentType: 'image/png' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/gallery`)
      .expect(200);
    expect(res.body.find((p: { caption: string }) => p.caption === 'Public Photo')).toBeDefined();
  });

  it('404 for a nonexistent slug on public gallery', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/this-slug-does-not-exist/gallery')
      .expect(404);
  });

  it('public achievements route returns achievements sorted by year, no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Public Award', description: 'x', year: 2025 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/achievements`)
      .expect(200);
    expect(res.body.find((a: { title: string }) => a.title === 'Public Award')).toBeDefined();
  });

  it('404 for a nonexistent slug on public achievements', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/this-slug-does-not-exist/achievements')
      .expect(404);
  });
});
```

- [ ] **Step 5: Run the two updated e2e specs**

Run: `cd backend && npm run test:e2e -- public`
Expected: `Test Suites: 2 passed, 2 total` / `Tests: 7 passed, 7 total` — same 7 tests as before, now slug-keyed.

- [ ] **Step 6: Run the full backend suite to confirm nothing else broke**

Run: `cd backend && npm test && npm run test:e2e`
Expected: 101/101 unit, 327/327 e2e (unchanged totals).

- [ ] **Step 7: Commit**

```bash
git add backend/src/public/public.controller.ts backend/src/public/public.service.ts backend/test/public-profile.e2e-spec.ts backend/test/public-gallery-achievements.e2e-spec.ts
git commit -m "refactor(backend): public club routes key on orgSlug instead of orgId"
```

---

### Task 2: Frontend types + public data hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Create: `frontend/features/public/use-public-club.ts`

**Interfaces:**
- Produces: `PublicProfile`, `PublicGalleryPhoto`, `PublicAchievement` types; `usePublicProfile(orgSlug: string)`, `usePublicGallery(orgSlug: string)`, `usePublicAchievements(orgSlug: string)`.

No test file for this task — matches this project's convention that thin `api()`-wrapping hook files (`use-assets.ts`, `use-minutes.ts`) aren't unit-tested directly, only exercised via consumers' live verification.

- [ ] **Step 1: Add the three public response types**

Append to the end of `frontend/types/api.ts`:

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

- [ ] **Step 2: Implement the three public query hooks**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicAchievement, PublicGalleryPhoto, PublicProfile } from '@/types/api';

export function usePublicProfile(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'profile'],
    queryFn: () => api<PublicProfile>(`/public/organizations/${orgSlug}/profile`, { auth: false }),
    retry: false, // a 404 here is a meaningful "no such club" answer, not a flake
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

Save as `frontend/features/public/use-public-club.ts`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/public/use-public-club.ts
git commit -m "feat(frontend): public club page types + data hooks"
```

---

### Task 3: PublicProfileHero + PublicUpcomingEvents

**Files:**
- Create: `frontend/components/public/public-profile-hero.tsx`
- Create: `frontend/components/public/public-upcoming-events.tsx`

**Interfaces:**
- Consumes: `PublicProfile` (Task 2).
- Produces: `<PublicProfileHero profile={PublicProfile} />`, `<PublicUpcomingEvents events={PublicProfile['upcomingEvents']} />`.

- [ ] **Step 1: Implement `PublicProfileHero`**

```tsx
import { Building2 } from 'lucide-react';
import type { PublicProfile } from '@/types/api';

export function PublicProfileHero({ profile }: { profile: PublicProfile }) {
  const socialEntries = Object.entries(profile.socialLinks ?? {});
  const advisors = profile.advisors ?? [];

  return (
    <div className="flex flex-col">
      <div className="h-48 w-full overflow-hidden bg-surface-secondary sm:h-64">
        {profile.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={profile.bannerUrl} alt={`${profile.name} banner`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Building2 className="size-10 text-foreground-subtle" />
          </div>
        )}
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-3xl flex-col gap-3 px-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border-4 border-surface bg-surface-secondary">
          {profile.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
            <img src={profile.logoUrl} alt={`${profile.name} logo`} className="h-full w-full object-cover" />
          ) : (
            <Building2 className="size-6 text-foreground-subtle" />
          )}
        </div>

        <h1 className="text-2xl font-semibold">{profile.name}</h1>
        {profile.description && <p className="text-sm text-foreground-muted">{profile.description}</p>}

        {socialEntries.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {socialEntries.map(([key, value]) => (
              <a key={key} href={value} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                {key}
              </a>
            ))}
          </div>
        )}

        {advisors.length > 0 && (
          <div>
            <h2 className="text-sm font-medium">Advisors</h2>
            <ul className="list-inside list-disc text-sm text-foreground-muted">
              {advisors.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
```

Save as `frontend/components/public/public-profile-hero.tsx`. Uses a raw `<img>`, same as every branding/gallery/QR image elsewhere in this app (Slice 12's `BrandingPanel`, Slice 5's QR display) — `next/image`'s `<Image>` component has never been used in this codebase, and these are already-signed, expiring MinIO URLs that gain nothing from Next's image optimizer.

- [ ] **Step 2: Implement `PublicUpcomingEvents`**

```tsx
import { CalendarDays } from 'lucide-react';
import type { PublicProfile } from '@/types/api';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PublicUpcomingEvents({ events }: { events: PublicProfile['upcomingEvents'] }) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4">
      <h2 className="text-lg font-medium">Upcoming events</h2>
      {events.length === 0 ? (
        <p className="text-sm text-foreground-muted">No upcoming events.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-domain-events" />
              <div>
                <p className="text-sm font-medium">{e.title}</p>
                <p className="text-sm text-foreground-muted">
                  {dateFmt.format(new Date(e.startAt))}
                  {e.venue ? ` · ${e.venue}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Save as `frontend/components/public/public-upcoming-events.tsx`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/public/public-profile-hero.tsx frontend/components/public/public-upcoming-events.tsx
git commit -m "feat(frontend): public profile hero + upcoming events sections"
```

---

### Task 4: PublicGalleryGrid

**Files:**
- Create: `frontend/components/public/public-gallery-grid.tsx`

**Interfaces:**
- Consumes: `usePublicGallery` (Task 2).
- Produces: `<PublicGalleryGrid orgSlug={string} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { usePublicGallery } from '@/features/public/use-public-club';

export function PublicGalleryGrid({ orgSlug }: { orgSlug: string }) {
  const gallery = usePublicGallery(orgSlug);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4">
      <h2 className="text-lg font-medium">Gallery</h2>
      {gallery.isPending && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      )}
      {gallery.isError && <p className="text-sm text-foreground-muted">Couldn&apos;t load photos.</p>}
      {gallery.data && gallery.data.length === 0 && (
        <p className="text-sm text-foreground-muted">No photos yet.</p>
      )}
      {gallery.data && gallery.data.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {gallery.data.map((photo) => (
            <a
              key={photo.id}
              href={photo.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="block aspect-square overflow-hidden rounded-md bg-surface-secondary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here */}
              <img src={photo.downloadUrl} alt={photo.caption ?? 'Gallery photo'} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
```

Save as `frontend/components/public/public-gallery-grid.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/public/public-gallery-grid.tsx
git commit -m "feat(frontend): PublicGalleryGrid"
```

---

### Task 5: PublicAchievementsList

**Files:**
- Create: `frontend/components/public/public-achievements-list.tsx`

**Interfaces:**
- Consumes: `usePublicAchievements` (Task 2).
- Produces: `<PublicAchievementsList orgSlug={string} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { Trophy } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicAchievements } from '@/features/public/use-public-club';

export function PublicAchievementsList({ orgSlug }: { orgSlug: string }) {
  const achievements = usePublicAchievements(orgSlug);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-12">
      <h2 className="text-lg font-medium">Achievements</h2>
      {achievements.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {achievements.isError && <p className="text-sm text-foreground-muted">Couldn&apos;t load achievements.</p>}
      {achievements.data && achievements.data.length === 0 && (
        <p className="text-sm text-foreground-muted">No achievements yet.</p>
      )}
      {achievements.data && achievements.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {achievements.data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Trophy className="mt-0.5 size-4 shrink-0 text-domain-certificates" />
              <div>
                <p className="text-sm font-medium">
                  {a.title} <span className="text-foreground-muted">— {a.year}</span>
                </p>
                <p className="text-sm text-foreground-muted">{a.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Save as `frontend/components/public/public-achievements-list.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/public/public-achievements-list.tsx
git commit -m "feat(frontend): PublicAchievementsList"
```

---

### Task 6: Page wiring — `/club/[orgSlug]`

**Files:**
- Create: `frontend/app/club/[orgSlug]/page.tsx`

**Interfaces:**
- Consumes: `usePublicProfile` (Task 2), `PublicProfileHero`/`PublicUpcomingEvents` (Task 3), `PublicGalleryGrid` (Task 4), `PublicAchievementsList` (Task 5).
- Produces: the real `/club/[orgSlug]` route.

- [ ] **Step 1: Implement the page**

```tsx
'use client';

import { use } from 'react';
import { Building2 } from 'lucide-react';
import { PublicProfileHero } from '@/components/public/public-profile-hero';
import { PublicUpcomingEvents } from '@/components/public/public-upcoming-events';
import { PublicGalleryGrid } from '@/components/public/public-gallery-grid';
import { PublicAchievementsList } from '@/components/public/public-achievements-list';
import { usePublicProfile } from '@/features/public/use-public-club';

function ClubNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <Building2 className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Club not found</h1>
      <p className="text-sm text-foreground-muted">
        This page may have moved, or the club no longer exists.
      </p>
    </div>
  );
}

export default function PublicClubPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = use(params);
  const profile = usePublicProfile(orgSlug);

  if (profile.isPending) return null;
  if (profile.isError || !profile.data) return <ClubNotFound />;

  return (
    <div className="flex min-h-dvh flex-col gap-8 pb-8">
      <PublicProfileHero profile={profile.data} />
      <PublicUpcomingEvents events={profile.data.upcomingEvents} />
      <PublicGalleryGrid orgSlug={orgSlug} />
      <PublicAchievementsList orgSlug={orgSlug} />
    </div>
  );
}
```

Save as `frontend/app/club/[orgSlug]/page.tsx`.

- [ ] **Step 2: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; 145/145 still passing (this task adds no new tests).

- [ ] **Step 3: Run the production build**

Run: `cd frontend && npm run build`
Expected: clean build, including the new `/club/[orgSlug]` route.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/club/[orgSlug]/page.tsx"
git commit -m "feat(frontend): /club/[orgSlug] public page wiring"
```

---

### Task 7: Settings — "View public page" link

**Files:**
- Create: `frontend/components/orgs/public-page-link.tsx`
- Modify: `frontend/components/orgs/organization-tab.tsx`

**Interfaces:**
- Consumes: `Organization.slug` (already exists on the type).
- Produces: `<PublicPageLink slug={string} />`, wired into `OrganizationTab` as a fourth section.

- [ ] **Step 1: Implement `PublicPageLink`**

```tsx
'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

export function PublicPageLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/club/${slug}` : `/club/${slug}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        <ExternalLink className="size-3.5" />
        View public page
      </a>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied!' : 'Copy link'}
      </Button>
    </div>
  );
}
```

Save as `frontend/components/orgs/public-page-link.tsx`.

- [ ] **Step 2: Wire it into `OrganizationTab`**

In `frontend/components/orgs/organization-tab.tsx`, add the import:

```typescript
import { PublicPageLink } from '@/components/orgs/public-page-link';
```

and add a new section before the closing `</div>` of the returned JSX (after the "Colors" section):

```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Public page</h2>
        <PublicPageLink slug={org.data.slug} />
      </section>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/orgs/public-page-link.tsx frontend/components/orgs/organization-tab.tsx
git commit -m "feat(frontend): \"View public page\" link in Settings"
```

---

### Task 8: Live verification (PAUSE before starting)

**Do not start this task until the user explicitly says to continue.**

Start the dev stack (`docker compose up -d` if not already running, then backend + frontend dev servers). This slice's defining check is different from every prior frontend slice: the page must work with **zero authentication at all**, not just a different role.

Checklist:
- [ ] As a committee member (any existing test org's PRESIDENT), open Settings → Organization tab, confirm the new "Public page" section renders, click "View public page" and confirm it opens `/club/<real-slug>` in a new tab with the right org's data.
- [ ] Click "Copy link", confirm the button shows "Copied!" briefly, paste the clipboard content and confirm it matches the URL just opened.
- [ ] **In a genuinely logged-out browser context** (new incognito/private window, or clear all site storage first — not just a different account) navigate directly to `/club/<real-slug>`. Confirm: banner/logo/name/description render, social links are clickable, advisors list renders, upcoming events show only `PUBLISHED` events (never `DRAFT`), gallery grid renders real uploaded photos (if any exist — seed one via the API first if the test org has none) and each opens the full image in a new tab, achievements list renders sorted by year descending.
- [ ] Still logged out, navigate to `/club/this-slug-does-not-exist` — confirm the "Club not found" state renders, no crash, no redirect loop.
- [ ] Confirm the page never triggers a login redirect at any point — check the Network tab for any 401 followed by a redirect to `/login` (would indicate something accidentally required auth).
- [ ] Both themes screenshotted (the page should follow the visitor's system/local theme preference the same as any other page, since theme is a `documentElement` attribute set before hydration, unrelated to auth).

Fix anything found (one root-cause fix at a time, per systematic-debugging), commit each fix separately, then report the final test counts before proceeding to docs sync.

---

## After Task 8 (pause before each, per standing preference)

**Docs sync:** append a "Frontend Slice 13 — Public Club Page" section to `docs/current-context.md` (scope, task list with commit hashes, the orgId→orgSlug backend rename, test baseline, "what's real" summary, note that Gallery management and Achievements management remain the next two Public Club Page sub-slices) and a "Slice 13" section to `docs/uiux.md` (the unauthenticated-route pattern as a new precedent, the free-form social-links rendering reusing Slice 12's data shape, the logged-out live-verification requirement as a new checklist category).

**Finish branch:** verify tests (backend `npm test`/`npm run test:e2e`, frontend `npm test`/`npm run build`), merge to `main` locally, delete `feature/frontend-slice13-public-club-page`, per standing preference (never push, never ask).
