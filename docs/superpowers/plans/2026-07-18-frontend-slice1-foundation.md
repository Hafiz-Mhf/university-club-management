# Frontend Slice 1 — Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Stand up `frontend/` from nothing: Next.js scaffold, Warm Editorial
Neutral tokens (light+dark), auth flow (login/register/refresh/logout/consent
re-prompt), org context with per-org branding, app shell (sidebar/topbar),
and a real Dashboard page against `GET /organizations/:orgId/dashboard`.

**Spec:** `docs/superpowers/specs/2026-07-18-frontend-slice1-foundation-design.md`
— the spec is the authority on behavior; this plan sequences the work.

**Tech stack:** Next.js (App Router, TS), Tailwind v4, shadcn/ui, TanStack
Query, Zustand, React Hook Form + Zod, Lucide, Vitest + React Testing Library.

## Global constraints

- `frontend/` does not exist yet — Task 1 creates it. Nothing in `backend/`
  changes except the one-line CORS enable in Task 3.
- Backend test baseline before starting: 101 unit / 326 e2e (verified
  2026-07-17 after Consent-versioned re-prompt). Re-run the backend suite in
  Task 3 (the only backend-touching task) — both counts must hold.
- Frontend verification per task: `npm run build` (compiles clean) plus
  `npm test` (Vitest) once tests exist (Task 2 onward). No Playwright this
  slice (spec decision).
- One commit per task. Design values (hex, radii, fonts, spacing) come from
  `design.md` — do not invent new ones; if a needed token is missing there,
  stop and flag it rather than improvising.
- All API calls go through `lib/api.ts`. No component ever calls `fetch`
  directly or hardcodes a URL.
- Icons: Lucide only — never emoji (design.md baseline).

---

### Task 1: Scaffold, tokens, fonts, theme

**Files (created under `frontend/` unless noted):**
- Scaffold output (`package.json`, `next.config.ts`, `tsconfig.json`, `app/…`)
- `styles/globals.css` — full `@theme` token system
- `app/layout.tsx` — fonts, theme attribute, no-flash script
- `components/theme/theme-provider.tsx`, `components/theme/theme-toggle.tsx`
- `hooks/use-theme.ts` (Zustand-persisted, defaults to system)
- `components.json` (shadcn init) + `components/ui/*` for: button, card,
  input, label, dropdown-menu, dialog, skeleton, badge, avatar, separator,
  sheet, form, sonner (toast)

**Steps:**

- [ ] **Step 1: Scaffold.** From repo root:
  `npx create-next-app@latest frontend --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm`
  (accept defaults otherwise; Turbopack default is fine). Then in `frontend/`:
  `npx shadcn@latest init` (style: default; base color: neutral — our tokens
  replace it anyway) and add the component list above.
- [ ] **Step 2: Install deps.**
  `npm i @tanstack/react-query zustand react-hook-form zod @hookform/resolvers lucide-react motion`
  and dev deps
  `npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom`.
  Add `vitest.config.ts` (react plugin, jsdom, `@` alias, setup file with
  jest-dom) and a `"test": "vitest run"` script now so every later task can
  run it, plus a trivial smoke test (`lib/__tests__/smoke.test.ts`,
  `expect(true).toBe(true)`) proving the runner works.
- [ ] **Step 3: Tokens.** Replace scaffold `globals.css` with the Warm
  Editorial Neutral system from `design.md`. Shape:

```css
@import "tailwindcss";

:root {
  --background: #FAFAF8;
  --surface: #FFFFFF;
  --surface-secondary: #F3F2EE;
  --border: #E7E5E0;
  --foreground: #201F1C;
  --foreground-muted: #6B6862;
  --foreground-subtle: #8F8C85;
  --primary: #6E56CF;
  --primary-foreground: #FFFFFF;
  --secondary: #5B8DEF;
  --domain-events: #7C5CFC;
  --domain-registrations: #2F7DE1;
  --domain-attendance: #0EA5A3;
  --domain-certificates: #B8860B;
  --domain-feedback: #E1487D;
  --domain-analytics: #3F9142;
  --domain-ops: #A16A4A;
  --success: #2F9E44;
  --warning: #C77D11;
  --danger: #DC2626;
  --info: #2F7DE1;
  --radius-sm: 0.5rem;
  --radius: 0.625rem;
  --radius-lg: 1rem;
  --shadow-card: 0 1px 2px rgba(32,26,20,0.04), 0 4px 12px rgba(32,26,20,0.06);
}

[data-theme="dark"] {
  --background: #18171B;
  --surface: #211F24;
  --surface-secondary: #131216;
  --border: #2C2A30;
  --foreground: #F2F1EE;
  --foreground-muted: #A8A5A0;
  --foreground-subtle: #78756F;
  --domain-events: #9B85FF;
  --domain-registrations: #5B9CF5;
  --domain-attendance: #2DD4CE;
  --domain-certificates: #D9A93E;
  --domain-feedback: #F06B9B;
  --domain-analytics: #5FB563;
  --domain-ops: #C08A66;
  --success: #4ADE6E;
  --warning: #E0A340;
  --danger: #F87171;
  --info: #5B9CF5;
  --shadow-card: none;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-secondary: var(--surface-secondary);
  --color-border: var(--border);
  --color-foreground: var(--foreground);
  --color-foreground-muted: var(--foreground-muted);
  --color-foreground-subtle: var(--foreground-subtle);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-domain-events: var(--domain-events);
  --color-domain-registrations: var(--domain-registrations);
  --color-domain-attendance: var(--domain-attendance);
  --color-domain-certificates: var(--domain-certificates);
  --color-domain-feedback: var(--domain-feedback);
  --color-domain-analytics: var(--domain-analytics);
  --color-domain-ops: var(--domain-ops);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-info: var(--info);
  --font-heading: var(--font-hanken), sans-serif;
  --font-sans: var(--font-inter), sans-serif;
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius);
  --radius-lg: var(--radius-lg);
  --shadow-card: var(--shadow-card);
}
```

  Also map shadcn's expected variables (`--color-card`, `--color-muted`,
  `--color-destructive`, `--color-ring`, etc.) onto these tokens in the same
  block so the added `components/ui/*` render on-system without per-component
  edits.
- [ ] **Step 4: Fonts + layout.** `app/layout.tsx`: `Hanken_Grotesk` and
  `Inter` via `next/font/google` (`variable: '--font-hanken'` /
  `'--font-inter'`, subsets `['latin']`, `display: 'swap'`), both variables on
  `<html>`. Inline `<script>` (before hydration) reads
  `localStorage['ucm-theme']` falling back to `prefers-color-scheme` and sets
  `data-theme` — no flash. Body: `bg-background text-foreground font-sans`.
- [ ] **Step 5: Theme provider + toggle.** `use-theme.ts`: Zustand store
  persisted to `ucm-theme` (`'light' | 'dark' | 'system'`), effect syncs
  `data-theme` and reacts to system changes when `'system'`. Toggle component:
  Lucide `Sun`/`Moon`, cycles light→dark→system, accessible label.
- [ ] **Step 6: Prove it.** Temporary content on the root page: heading
  (font-heading), body text, one card with `shadow-card`, one badge per
  domain hue, buttons (primary/secondary/ghost), the theme toggle. Run
  `npm run build` + `npm test` — clean. Visual check both themes via
  `npm run dev` (verify warm neutrals, not slate; dark mode not pure black).
- [ ] **Step 7: Commit.**
  `git add frontend/ && git commit -m "feat(frontend): scaffold + Warm Editorial Neutral tokens, fonts, dark mode"`

---

### Task 2: API client + auth store + token refresh

**Files:**
- `lib/api.ts` — fetch wrapper + refresh single-flight
- `features/auth/auth-store.ts` — Zustand: `{accessToken, user, consentStale, status}`
- `features/auth/use-session-restore.ts` — boot-time refresh exchange
- `lib/query-client.tsx` — TanStack Query provider wired into root layout
- `types/api.ts` — auth/org/dashboard response types
- Tests: `lib/__tests__/api.test.ts`, `features/auth/__tests__/auth-store.test.ts`

**Interfaces produced:**
- `api<T>(path, {method, body, auth}): Promise<T>` — throws typed `ApiError{status, message}`.
- `authStore`: `setSession({accessToken, refreshToken, consentStale})`,
  `clearSession()`, `getAccessToken()`; refresh token persisted to
  `localStorage['ucm-refresh']`; access token memory-only (spec).

**Steps:**

- [ ] **Step 1: Write failing tests.** `api.test.ts` (mock `global.fetch`):
  attaches bearer header; 401 → exactly one `POST /auth/refresh` then
  retries original once (assert fetch call order/count); two concurrent 401s
  share one refresh call (single-flight); refresh failure → session cleared +
  `onAuthFailure` callback fired; non-401 errors surface as `ApiError`
  without refresh attempts. `auth-store.test.ts`: login stores triple
  (refresh in localStorage, access in memory only — assert
  `localStorage['ucm-access']` absent), `clearSession` wipes both,
  `consentStale` flag round-trips.
- [ ] **Step 2: Run tests — red.** `npm test` fails (modules don't exist).
- [ ] **Step 3: Implement** `api.ts`, `auth-store.ts`, `use-session-restore.ts`
  (on mount: refresh token present → `POST /auth/refresh` → `setSession`,
  else mark `status: 'anonymous'`; expose `status:
  'restoring'|'authenticated'|'anonymous'`), `query-client.tsx` (default
  `staleTime` 30s, `retry: 1`, mounted in root layout).
- [ ] **Step 4: Green.** `npm test` all pass; `npm run build` clean.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(frontend): API client with single-flight refresh, auth store, query provider"`

---

### Task 3: Auth pages + consent gate + backend CORS

**Files:**
- `app/(auth)/layout.tsx` — centered card on canvas, no shell
- `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`,
  `app/(auth)/consent/page.tsx`
- `features/auth/schemas.ts` — Zod: login `{email, password}`, register
  `{fullName, email, password ≥8, consent literal true}`
- `features/auth/use-auth.ts` — login/register/logout/renewConsent mutations
- Modify: `backend/src/main.ts` — CORS enable
- Modify: `lib/api.ts` — consent-403 detection → route to `/consent`

**Steps:**

- [ ] **Step 1: Backend CORS.** In `main.ts`, before `listen`:
  `app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000' });`
  Run backend suites: `cd backend && npm test && npm run test:e2e` — must
  stay 101/326.
- [ ] **Step 2: Auth pages.** RHF + `zodResolver`. Login: email/password,
  inline field errors on blur, top-level error for 401 ("Invalid email or
  password"), submit disabled+spinner while pending; on success
  `setSession(...)` then → `consentStale ? /consent : /` . Register:
  fullName/email/password/consent checkbox (label links the policy version
  string `v1`); 409 → "Email already registered" on the email field; success
  → auto-login (call login mutation) → same routing. Consent page: policy
  version, short explanation, primary "I agree" → `POST /me/consent` → back
  to `next` param or `/`; secondary quiet links to `/me/export`-backed "my
  data" page are **out of scope** — plain text note only this slice.
- [ ] **Step 3: Consent-403 interception.** In `api.ts`: a 403 whose body
  message is `"Account consent must be renewed"` sets `consentStale` in the
  store and redirects to `/consent?next=<current path>` (client-side; guard
  against redirect loops by excluding `/consent` itself). Unit test this
  branch (extend `api.test.ts`).
- [ ] **Step 4: Route protection.** `(app)` group layout: `status ===
  'restoring'` → full-page centered spinner; `'anonymous'` → redirect
  `/login`; authenticated + `consentStale` → `/consent`. (The `(app)` layout
  is created here as a bare pass-through with this guard; the visual shell
  arrives in Task 5.)
- [ ] **Step 5: Verify.** `npm test` + `npm run build`. Manual: register →
  login → land on placeholder root; backdate consent via Prisma (reuse the
  e2e idiom manually or via a login on a stale user) → visit any page →
  bounced to `/consent` → agree → returned.
- [ ] **Step 6: Commit** (frontend + backend main.ts together — one logical
  change):
  `git commit -m "feat(frontend): auth pages + consent gate; backend CORS locked to frontend origin"`

---

### Task 4: Org context — provider, switcher, create-org, branding

**Files:**
- `features/orgs/use-orgs.ts` — `GET /organizations`, `GET /organizations/:id`,
  `GET /organizations/:orgId/members/me`, `POST /organizations`
- `features/orgs/org-provider.tsx` — slug→org resolution, `{org, membership,
  role}` context, branding CSS-variable override, contrast fallback
- `features/orgs/contrast.ts` — relative-luminance ratio helper
- `components/shell/org-switcher.tsx`
- `app/(app)/welcome/page.tsx` — zero-orgs landing, create-org form
- `app/(app)/[orgSlug]/layout.tsx` — wraps children in `OrgProvider`
- Tests: `features/orgs/__tests__/contrast.test.ts`,
  `features/orgs/__tests__/org-provider.test.tsx`

**Steps:**

- [ ] **Step 1: Failing tests.** `contrast.test.ts`: ratio math on known
  pairs (`#6E56CF` vs `#FAFAF8` passes 3:1; `#FFFF00` vs `#FAFAF8` fails →
  fallback). `org-provider.test.tsx` (mocked queries): resolves slug to org;
  unknown slug with orgs available → redirect to the first org's dashboard
  (list is name-ordered by the backend); unknown slug with zero orgs →
  redirect `/welcome`; org with `primaryColor` sets `--primary` inline on
  the wrapper; org whose color fails contrast against the active theme
  canvas leaves the platform default in place.
- [ ] **Step 2: Red, then implement.** Provider details: org list via
  TanStack Query (`['orgs']`); active org matched by `slug` route param;
  membership role via `['org', id, 'me']`. Branding override: inline
  `style={{'--primary': org.primaryColor, '--secondary': org.secondaryColor}}`
  on the provider's wrapper div when contrast check passes (check against the
  *current* theme's `--background` value; re-evaluate on theme change).
- [ ] **Step 3: Switcher + welcome.** Switcher (shadcn DropdownMenu): current
  org name + logo avatar (fallback: initials on primary tint), org list,
  "Create organization" item. Welcome page: friendly heading, create form
  (name + slug, slug auto-suggested `kebab-case(name)` editable, RHF+Zod
  mirroring backend DTO), success → `router.push('/'+slug)`. Zero-orgs users
  landing anywhere in `(app)` get redirected here by the provider.
- [ ] **Step 4: Green + build.** `npm test`, `npm run build`.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(frontend): org context, switcher, create-org, per-org branding with contrast fallback"`

---

### Task 5: App shell — sidebar, topbar, placeholder routes

**Files:**
- `components/shell/sidebar.tsx`, `components/shell/topbar.tsx`,
  `components/shell/user-menu.tsx`, `components/shell/nav-items.ts`
- `components/shell/placeholder-page.tsx`
- `app/(app)/[orgSlug]/layout.tsx` — gains the visual shell (sidebar + topbar
  around content)
- Placeholder routes: `app/(app)/[orgSlug]/{events,members,attendance,certificates,feedback,analytics,workspace,settings}/page.tsx`
  (each renders `<PlaceholderPage domain=… title=… />`)

**Steps:**

- [ ] **Step 1: Nav config.** `nav-items.ts`: array of `{label, href, icon,
  domainToken, minTier}` — Dashboard (LayoutDashboard, no tint — primary
  pill when active is enough), Events (CalendarDays, events), Members
  (Users, no tint — member management has no domain hue in design.md; the
  hue system is for the seven listed domains only, and inventing an eighth
  here would dilute it), Attendance (QrCode, attendance), Certificates
  (Award, certificates), Feedback (MessageSquareHeart, feedback), Analytics
  (ChartNoAxesCombined, analytics), Workspace (FolderOpen, ops), Settings
  (Settings, no tint). `minTier`: `'member' | 'committee'` — committee =
  MANAGE_EVENTS role set (mirror `role-groups.ts` names in a small
  `features/orgs/roles.ts`).
- [ ] **Step 2: Sidebar.** 260px fixed, `bg-surface-secondary`, full-height:
  org switcher top; nav list (icon tinted `text-domain-*`, label; active =
  soft primary-tint pill + 3px left `bg-primary` indicator — Stitch-kept
  treatment); bottom: theme toggle + user menu (avatar initials, name/email,
  logout). <1024px: collapses into shadcn `Sheet` triggered from topbar
  hamburger. Role-aware: `minTier: 'committee'` items hidden from
  non-committee roles.
- [ ] **Step 3: Topbar.** Breadcrumb (org name / current page label from nav
  config), right side: reserved flex slot (future ⌘K), mobile hamburger.
- [ ] **Step 4: Placeholder page.** Centered, domain-hue icon in a soft tint
  circle, feature name (font-heading), one line: "Coming in a later slice."
  Small, calm, honest.
- [ ] **Step 5: Verify.** `npm run build` + `npm test` (existing suites stay
  green). Manual: navigate all nav items both themes; collapse behavior at
  narrow width; participant-role nav trimming (fake role by pointing at a
  PARTICIPANT membership org).
- [ ] **Step 6: Commit.**
  `git commit -m "feat(frontend): app shell — sidebar with domain-hue nav, topbar, placeholder routes"`

---

### Task 6: Dashboard page

**Files:**
- `features/dashboard/use-dashboard.ts` — `GET /organizations/:orgId/dashboard`
- `features/dashboard/format.ts` — audit-action → sentence map, relative time,
  number formatting
- `components/dashboard/kpi-card.tsx`, `components/dashboard/upcoming-events.tsx`,
  `components/dashboard/pending-approvals.tsx`,
  `components/dashboard/recent-registrations.tsx`,
  `components/dashboard/activity-feed.tsx`
- `app/(app)/[orgSlug]/page.tsx` — the dashboard route (org root)
- `app/(app)/[orgSlug]/participant-home.tsx` — participant landing (rendered
  in place of dashboard on 403/role)
- Tests: `features/dashboard/__tests__/format.test.ts`

**Steps:**

- [ ] **Step 1: Failing tests** for `format.ts`: `'event.publish'` → "published
  an event", `'member.role.change'` → "changed a member's role", unknown
  action → humanized fallback (`'x.y'` → "x y"); relative time ("2h ago",
  "just now"); `1248` → "1,248".
- [ ] **Step 2: Implement + green.**
- [ ] **Step 3: Page assembly.** Layout: 4-col KPI row (1-col mobile, 2-col
  tablet) — value `font-heading text-3xl`, label caption, small domain-hue
  icon chip top-right, **no trend arrows** (backend has no deltas — spec
  forbids inventing them). Below: two-column grid (upcoming events + pending
  approvals) then (recent registrations + activity feed); each a `Card` with
  `card-title` header and count badge. Empty states: one quiet line each
  ("No upcoming events"). Loading: `Skeleton` blocks matching final layout.
  Error: inline message + retry button (TanStack `refetch`).
- [ ] **Step 4: Role handling.** Committee roles get the dashboard query;
  PARTICIPANT/VOLUNTEER/ALUMNI render `participant-home.tsx` (greeting,
  org name, note that participant features arrive in later slices) without
  ever firing the 403-destined query (role known from org context).
- [ ] **Step 5: Verify.** `npm test` + `npm run build`. Manual against live
  backend (docker stack + seeded org): KPIs match DB, feed renders sentences,
  both themes, mobile reflow.
- [ ] **Step 6: Commit.**
  `git commit -m "feat(frontend): dashboard — KPI cards, widgets, activity feed, participant landing"`

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** create `docs/uiux.md` — token architecture (CSS-variable
layers: theme → org override), shell composition, auth/refresh/consent flow
diagram-in-prose, org-branding mechanism + contrast fallback, what exists vs
placeholder. Update `docs/current-context.md` (untracked) with slice-1
shipped state and the slice roadmap (2: events+registrations, 3:
attendance+certificates, …).

**Finish branch:** backend suite still 101/326, frontend `npm test` +
`npm run build` green → merge `feature/frontend-slice1-foundation` to main
locally, delete branch. Never push.
