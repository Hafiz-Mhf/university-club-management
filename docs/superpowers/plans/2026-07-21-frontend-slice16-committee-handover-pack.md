# Frontend Slice 16 (Committee Handover Pack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a committee-side "Download Handover Pack" action, completing the last unshipped item on Phase 2 — Organization Workspace.

**Architecture:** A new `apiDownloadBlob` helper in `lib/api.ts` (sibling to `api()`/`apiUpload()`) fetches the already-shipped `GET /organizations/:orgId/handover` PDF-streaming endpoint and returns a `Blob`. A thin mutation hook wraps it; a button component (copying `ExportDataButton`'s shape) triggers the browser download. Wired into `OrganizationTab` as a new section. No new backend endpoints.

**Tech Stack:** Next.js App Router, TanStack Query, native `fetch`/`Blob`/`URL.createObjectURL`.

## Global Constraints

- Frontend test baseline going in: **154/154** (34 suites) — verified via `npm test -- --run` immediately before writing this plan. Backend baseline: **101 unit / 327 e2e** (untouched this slice — `HandoverController`/`HandoverService`/`HandoverPdfService` already fully shipped).
- RBAC: matches `HandoverController`'s `@Roles(...MANAGE_EVENTS)` — i.e. `isCommittee` tier. No RBAC check is added inside `OrganizationTab` itself: `SettingsPage` already gates the entire "Organization" tab to `isCommittee` before `OrganizationTab` ever renders.
- `api()` in `frontend/lib/api.ts` always JSON-parses the response body and cannot be reused for a route that streams raw PDF bytes. The new `apiDownloadBlob` reuses the same internal `request()` helper (bearer token attach + 401→refresh→retry cycle) but returns `res.blob()` on success, and on failure parses the JSON error body the same way `api()` does and throws the same `ApiError`.
- Filename for the downloaded file: `handover-pack-${orgSlug}-${YYYY-MM-DD}.pdf`.
- One commit per task. Pause before Task 1 (after branch creation), pause before Task 5 (live verification), pause before docs-sync. Always merge-to-main on finish, no push.

---

### Task 1: `apiDownloadBlob` client helper

**Files:**
- Modify: `frontend/lib/api.ts`
- Test: `frontend/lib/__tests__/api.test.ts`

**Interfaces:**
- Produces: `apiDownloadBlob(path: string): Promise<Blob>`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `frontend/lib/__tests__/api.test.ts` (after the existing `describe('apiUpload', ...)` block, same file — it already imports `useAuthStore` and defines `jsonResponse`):

```typescript
describe('apiDownloadBlob', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOnAuthFailure(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response body as a Blob on success', async () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', consentStale: false });
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), { status: 200 }),
    );

    const blob = await apiDownloadBlob('/organizations/o1/handover');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3001/organizations/o1/handover');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('on 401: refreshes once, retries the original request, and returns the Blob', async () => {
    useAuthStore.getState().setSession({ accessToken: 'stale', refreshToken: 'ref-1', consentStale: false });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { accessToken: 'fresh', refreshToken: 'ref-2', consentStale: false }),
      )
      .mockResolvedValueOnce(new Response(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), { status: 200 }));

    const blob = await apiDownloadBlob('/organizations/o1/handover');

    expect(blob).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryCall = fetchMock.mock.calls[2];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('a failure response parses the JSON error body and throws ApiError', async () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', consentStale: false });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Organization not found' }));

    const err = (await apiDownloadBlob('/organizations/nope/handover').catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Organization not found');
  });
});
```

Update the import line at the top of the file to include the new export:

```typescript
import { api, apiUpload, apiDownloadBlob, ApiError, setOnAuthFailure, setOnConsentStale } from '@/lib/api';
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/__tests__/api.test.ts`
Expected: FAIL — `apiDownloadBlob` is not exported from `@/lib/api`.

- [ ] **Step 3: Implement**

Add to `frontend/lib/api.ts`, after the existing `apiUpload` function (end of file):

```typescript
export async function apiDownloadBlob(path: string): Promise<Blob> {
  const res = await request(path, {}, false);

  if (!res.ok) {
    const body = await parseBody(res);
    const message = messageOf(body, res.statusText);
    if (res.status === 403 && message === CONSENT_STALE_MESSAGE) {
      useAuthStore.getState().setConsentStale(true);
      onConsentStale?.();
    }
    throw new ApiError(res.status, message);
  }

  return res.blob();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/__tests__/api.test.ts`
Expected: PASS (all cases in the file, including the 3 new ones).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/__tests__/api.test.ts
git commit -m "feat(frontend): apiDownloadBlob client helper"
```

---

### Task 2: Handover data hook

**Files:**
- Create: `frontend/features/handover/use-handover.ts`

**Interfaces:**
- Consumes: `apiDownloadBlob` (Task 1).
- Produces: `useDownloadHandoverPack(orgId: string)` — a TanStack `useMutation` whose `mutate()`/`mutateAsync()` resolve to a `Blob`.

No test file for this task — matches this project's convention for thin `api()`-wrapping hook files (e.g. `use-gallery.ts`, `use-achievements.ts`).

- [ ] **Step 1: Implement**

```typescript
'use client';

import { useMutation } from '@tanstack/react-query';
import { apiDownloadBlob } from '@/lib/api';

export function useDownloadHandoverPack(orgId: string) {
  return useMutation({
    mutationFn: () => apiDownloadBlob(`/organizations/${orgId}/handover`),
  });
}
```

Save as `frontend/features/handover/use-handover.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/handover/use-handover.ts
git commit -m "feat(frontend): handover pack data hook"
```

---

### Task 3: HandoverPackButton

**Files:**
- Create: `frontend/components/orgs/handover-pack-button.tsx`

**Interfaces:**
- Consumes: `useDownloadHandoverPack` (Task 2).
- Produces: `<HandoverPackButton orgId={string} orgSlug={string} />`.

No test file for this task — matches `frontend/components/account/export-data-button.tsx`'s own precedent (an untested thin wrapper around a mutation whose only real behavior is DOM/Blob side effects).

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDownloadHandoverPack } from '@/features/handover/use-handover';
import { ApiError } from '@/lib/api';

export function HandoverPackButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const download = useDownloadHandoverPack(orgId);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    download.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `handover-pack-${orgSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={download.isPending} className="w-fit">
        {download.isPending && <Loader2 className="size-4 animate-spin" />}
        Download handover pack
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
```

Save as `frontend/components/orgs/handover-pack-button.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/orgs/handover-pack-button.tsx
git commit -m "feat(frontend): HandoverPackButton"
```

---

### Task 4: Page wiring — Handover pack section

**Files:**
- Modify: `frontend/components/orgs/organization-tab.tsx`

**Interfaces:**
- Consumes: `HandoverPackButton` (Task 3).
- Produces: the real "Handover pack" section in the Settings → Organization tab.

- [ ] **Step 1: Replace the file's full contents**

The current file (from Slice 12/13) has four sections: Profile, Branding, Colors, Public page. Replace the entire contents of `frontend/components/orgs/organization-tab.tsx`:

```tsx
'use client';

import { OrganizationProfileForm } from '@/components/orgs/organization-profile-form';
import { BrandingPanel } from '@/components/orgs/branding-panel';
import { OrgColorForm } from '@/components/orgs/org-color-form';
import { PublicPageLink } from '@/components/orgs/public-page-link';
import { HandoverPackButton } from '@/components/orgs/handover-pack-button';
import { useOrgDetail } from '@/features/orgs/use-orgs';
import { canManageOrgColors, canManageOrgProfile } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

export function OrganizationTab({ orgId, role }: { orgId: string; role: MembershipRole }) {
  const org = useOrgDetail(orgId);

  if (org.isPending) return null;
  if (org.isError || !org.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load organization details.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <OrganizationProfileForm orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Branding</h2>
        <BrandingPanel orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Colors</h2>
        <OrgColorForm orgId={orgId} org={org.data} canManage={canManageOrgColors(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Public page</h2>
        <PublicPageLink slug={org.data.slug} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Handover pack</h2>
        <p className="text-sm text-foreground-muted">
          A PDF export of your committee roster, recent meeting minutes, asset inventory, key files, and upcoming events — for committee rotation.
        </p>
        <HandoverPackButton orgId={orgId} orgSlug={org.data.slug} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, run the full frontend suite, and build**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: no type errors; 154 + 3 (Task 1) = 157/157 passing; clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/orgs/organization-tab.tsx
git commit -m "feat(frontend): Handover pack section wiring"
```

---

### Task 5: Live verification (PAUSE before starting)

**Do not start this task until the user explicitly says to continue.**

Start the dev stack (`docker compose ps` first — check for the recurring stopped-stack gotcha before assuming anything else is wrong; `docker compose up -d` if needed) and drive the real flow with Playwright against a committee (PRESIDENT) account and a non-committee (PARTICIPANT) account in the same org.

Checklist:
- [ ] As PRESIDENT: navigate to Settings → Organization tab, confirm a new "Handover pack" section appears below "Public page" with its description text and a "Download handover pack" button.
- [ ] Click the button, confirm the browser downloads a file named `handover-pack-<slug>-<date>.pdf`, confirm it's a real, non-empty PDF (open it) whose content matches the org's actual data (committee roster with correct roles; any existing meeting minutes/assets/files/upcoming events, or "None" if the test org has none of a given kind).
- [ ] Confirm the button shows a loading spinner while the request is in flight and is disabled during that window.
- [ ] As PARTICIPANT: confirm Settings only shows the "My Account" tab (no "Organization" tab at all) — this is pre-existing gating from Slice 12, not new; a quick sanity check only, not a new behavior to debug.
- [ ] Both themes screenshotted clean (the Settings section itself — PDFs have no theme).
- [ ] If the sidebar's theme-toggle button is intercepted by a `<nextjs-portal>` overlay again (hit in Slices 14 and 15, a Next.js dev-mode artifact, not an app bug), go straight to keyboard activation (`.focus()` + `Enter`) rather than retrying pointer clicks.

Fix anything found (one root-cause fix at a time, per systematic-debugging), commit each fix separately, then report the final test counts before proceeding to docs sync.

---

## After Task 5 (pause before each, per standing preference)

**Docs sync:** append a "Frontend Slice 16 — Committee Handover Pack" section to `docs/current-context.md` (scope, task list with commit hashes, test baseline, "what's real" summary, and a note that **this completes Phase 2 — Organization Workspace entirely**, backend and frontend both) and a "Slice 16" section to `docs/uiux.md` (the new `apiDownloadBlob` client capability and why `api()` couldn't be reused, the `ExportDataButton`-mirrored component shape, and the Phase-2-completion note). Also update the root `README.md`'s Phase 2 status table (Committee Handover Pack row: frontend 🔨 → ✅) and "In progress" section.

**Finish branch:** verify tests, merge to `main` locally, delete `feature/frontend-slice16-committee-handover-pack`, per standing preference (never push, never ask).
