# Frontend Slice 1 — Foundation — Design

First frontend work in the repo: `frontend/` does not exist yet. Backend is
complete through Phase 2 (see `docs/current-context.md`). The frontend ships
in slices, one at a time, through the same brainstorm → spec → plan → execute
cycle used for backend features. This slice is the foundation every later
slice builds on.

**In:** Next.js scaffold, the Warm Editorial Neutral design-token system
(`design.md`) implemented as Tailwind v4 theme + CSS variables with light/dark
mode, the authenticated app shell (sidebar + topbar), the full auth flow
(login, register, token refresh, logout, consent re-prompt), org context
(switcher, create-org, per-org branding override), and a real Dashboard page
wired to `GET /organizations/:orgId/dashboard`.

**Out (later slices, do not build):** events/members/attendance/certificates/
analytics/files/minutes/assets/feedback screens, public club page, mobile QR
scanner flow, settings/branding management pages. Nav links for these exist in
the sidebar but route to a small "coming soon" placeholder — the shell defines
the whole map; later slices fill it in.

**Design references:** `design.md` (the system of record) plus the Stitch
project "University Club Management" (`projects/6028687154741083710`) as a
*visual reference only* — layout ideas were reviewed and cherry-picked
(sidebar composition, member-directory 3-panel pattern for later slices, KPI
card treatment, QR viewfinder for slice 3+). Stitch HTML is **not** copied:
screens were incomplete (empty analytics body), contained features the
platform doesn't have (revenue KPI — payments are Phase 3), and had branding
inconsistencies.

---

## Scaffold & stack

`create-next-app` (latest, App Router, TypeScript, Tailwind, `src/` dir off,
import alias `@/*`) into `frontend/`. Then: shadcn/ui init, and the CLAUDE.md
stack table's libraries as they become needed — this slice pulls in TanStack
Query, Zustand, React Hook Form + Zod, Lucide, Motion. (CLAUDE.md's table
says "Next.js 18"; the scaffold uses whatever current stable `create-next-app`
produces — the spirit of the table is "current Next.js App Router".)

Dev proxy: `NEXT_PUBLIC_API_URL` env var (default `http://localhost:3001`)
consumed by a single API client module — no per-component fetch URLs.

**One backend touch:** `backend/src/main.ts` currently has no CORS config, so
browser calls from the frontend origin would be blocked. Enable
`app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000', credentials: false })`
— locked to a single known origin per the CLAUDE.md security baseline
("CORS locked"), never `*`. This is the only backend file this slice touches.

Directory layout (matches CLAUDE.md):

```
frontend/
├── app/                    # App Router routes
│   ├── (auth)/             # login, register, consent — no shell
│   ├── (app)/              # authenticated shell routes
│   │   └── [orgSlug]/      # org-scoped: dashboard, placeholder routes
│   └── layout.tsx          # root: fonts, theme class, providers
├── components/
│   ├── ui/                 # shadcn components
│   ├── shell/              # sidebar, topbar, org-switcher, user-menu
│   └── dashboard/          # KPI card, feed widgets
├── features/               # per-domain hooks + api calls (auth, orgs, dashboard)
├── hooks/                  # generic hooks (use-theme, use-media-query)
├── lib/                    # api client, query client, utils, tokens
├── services/               # (reserved — API service modules as slices grow)
├── styles/                 # globals.css with @theme tokens
└── types/                  # API response types
```

---

## Design tokens (from `design.md` — the implementation of record)

One `styles/globals.css` holding the entire Warm Editorial Neutral system:

- Tailwind v4 `@theme` block mapping CSS variables to utility names.
- Neutral canvas tokens (`--background`, `--surface`, `--surface-secondary`,
  `--border`, `--foreground`, `--foreground-muted`, `--foreground-subtle`)
  with light values at `:root` and dark values under `[data-theme="dark"]`.
- Brand tokens `--primary` / `--primary-foreground` / `--secondary` —
  defaulting to `#6E56CF` / white / `#5B8DEF`, overridden per-org at runtime
  (see Org context below).
- The seven domain-hue token pairs (`--domain-events`, `--domain-registrations`,
  `--domain-attendance`, `--domain-certificates`, `--domain-feedback`,
  `--domain-analytics`, `--domain-ops`) with light/dark variants, used only on
  icons/tags/badges per the design system's restraint rule.
- Semantic status tokens (`--success`, `--warning`, `--danger`, `--info`).
- Fonts: Hanken Grotesk (headings) + Inter (body) via `next/font/google` —
  not a CSS `@import` — subsets `latin`, `display: swap`, exposed as
  `--font-heading` / `--font-sans`.

Dark mode: `[data-theme]` attribute on `<html>`, toggled by a small
`ThemeProvider` (Zustand-persisted preference; default follows
`prefers-color-scheme`). No flash: inline script in root layout sets the
attribute before hydration.

---

## Auth flow

Backend contract (as shipped):

- `POST /auth/register` `{email, password, fullName, consent: true}` → `{id, email}` (201); 409 email taken; 400 missing consent.
- `POST /auth/login` `{email, password}` → `{accessToken, refreshToken, consentStale}` (201); 401 bad credentials.
- `POST /auth/refresh` `{refreshToken}` → same triple (rotation: old refresh token dies).
- `POST /auth/logout` `{refreshToken}` → revokes.
- `POST /me/consent` → re-consents (used when `consentStale: true` or any request 403s with "Account consent must be renewed").

Frontend handling:

- **Token storage:** access token in memory (Zustand store, never
  localStorage); refresh token in `localStorage` (accepted trade-off — the
  backend rotates refresh tokens and hashes them server-side; an httpOnly
  cookie isn't available since the API returns tokens in JSON bodies and
  lives on another origin in dev).
- **API client** (`lib/api.ts`): thin `fetch` wrapper that attaches
  `Authorization: Bearer <access>`, and on a 401 runs one refresh attempt
  (single-flight — concurrent 401s share one refresh promise) then retries
  the original request once. Refresh failure → clear auth state, redirect to
  `/login`.
- **Session restore:** on app load, if a refresh token exists, exchange it
  for a fresh pair before rendering authenticated routes (a small full-page
  loading state, not a flash of the login page).
- **Consent gate:** if login/refresh returns `consentStale: true`, or any
  API call returns the consent 403, route to `/consent` — a focused page
  showing the policy version with one primary "I agree" action calling
  `POST /me/consent`, then returning to where the user was. The PDPA-exempt
  routes stay reachable per backend design; the frontend consent page needs
  no special casing beyond using the exempt endpoints.
- **Auth pages** (`(auth)` group, no shell): login and register — centered
  card on the warm canvas, register includes the required consent checkbox
  (backend 400s without it). Zod schemas mirror backend DTO rules (password
  min 8, email format) so most validation errors never leave the client.

---

## Org context

- `GET /organizations` → user's orgs (id, name, slug, primaryColor,
  secondaryColor, logoKey…). `GET /organizations/:orgId` resolves signed
  `logoUrl`/`bannerUrl`.
- **Routing:** org-scoped routes live under `/(app)/[orgSlug]/…`. The slug →
  org resolution happens in an `OrganizationProvider` client component that
  loads the org list (TanStack Query), matches the slug, and provides
  `{org, membership}` context. Unknown slug → redirect to the switcher.
- **Switcher:** in the sidebar header — current org name/logo, dropdown of
  all memberships, "Create organization" action at the bottom. Zero orgs →
  `/welcome` page with create-org as the primary action (a new user's first
  screen).
- **Create org:** name + slug form (`POST /organizations`), slug
  auto-suggested from name, then redirect into the new org's dashboard.
- **Per-org branding:** `OrganizationProvider` writes the active org's
  `primaryColor`/`secondaryColor` onto the layout root as inline CSS variable
  overrides — every `--primary`-consuming component re-brands automatically.
  Contrast guard: if the org color fails ~3:1 against the current canvas, fall
  back to the platform default (simple luminance check, documented as
  best-effort).
- **Role awareness:** membership role comes from
  `GET /organizations/:orgId/members/me`; the provider exposes it so the
  sidebar can hide committee-only sections (Dashboard itself is
  MANAGE_EVENTS-gated server-side — a PARTICIPANT sees a trimmed nav and a
  participant-appropriate landing instead; for slice 1 that landing is the
  "coming soon" placeholder with their role acknowledged).

---

## App shell

**Sidebar** (`--surface-secondary`, 260px fixed, collapses to drawer <1024px):

- Org switcher at top.
- Nav sections in domain groups, each icon tinted its domain hue (Lucide):
  Dashboard · Events · Members · Attendance · Certificates · Feedback ·
  Analytics · Workspace (Files/Minutes/Assets) · Settings. Slice-1: only
  Dashboard is a real page; the rest render the placeholder route (visible
  but honest about being unbuilt — no dead links, no lying "empty states").
- Active item: soft primary-tinted pill + 3px left indicator (Stitch idea,
  kept).
- Bottom: theme toggle, user menu (name/email, logout, "My data" linking to
  the future PDPA page placeholder).

**Topbar:** breadcrumbs (org name / page), right side reserved for future
command palette (⌘K) — slice 1 ships the layout slot, not the palette.

**Placeholder route:** one shared component — domain icon in its hue, feature
name, one line ("Coming in a later slice"), calm, small. Not a marketing
tease, just an honest map marker.

---

## Dashboard page

Wired to `GET /organizations/:orgId/dashboard` (MANAGE_EVENTS-gated
server-side; response shape as shipped in `DashboardService.getSummary`):

- **KPI row (4 cards):** activeMembers, totalEvents, activeRegistrations,
  certificatesIssued — value in heading font, small tinted domain-hue icon
  chip (Stitch treatment, kept), no fake trend arrows (backend provides no
  deltas; do not invent them).
- **Upcoming events** (≤5): title, date, venue, registrationCount.
- **Pending approvals** (≤10): WAITLISTED registrations — eventTitle +
  createdAt. Actions (approve/reject) belong to the registrations slice, so
  rows are display-only here with a note-link to the future events page.
- **Recent registrations** (≤10): eventTitle, status badge, createdAt.
- **Activity feed** (≤15): audit rows — action rendered as a readable
  sentence ("event.publish" → "published an event"), relative timestamp.
- Loading: skeletons matching final layout (no CLS). Error: inline retry.
- 403 (participant role): the provider routes them to the participant
  landing instead of showing an error.

---

## Testing

Vitest + React Testing Library (jsdom). Logic-bearing units only:

- Token refresh single-flight + retry-once behavior (mock fetch).
- Auth store transitions (login/logout/session-restore/consent-stale).
- Org provider: slug resolution, branding variable override, contrast
  fallback.
- Dashboard data mapping (audit action → sentence, date formatting).
- No snapshot tests, no shallow render-the-world tests.

E2E (Playwright) deferred until slice 2+ when there's a multi-page flow worth
driving; noted here so its absence is a decision, not an oversight.

---

## Documentation

This slice creates `docs/uiux.md` (per CLAUDE.md's "iterative docs" rule —
document the system as built): token architecture, shell composition, auth
flow, org-branding mechanism. `design.md` remains the design-language source;
`docs/uiux.md` documents the implementation.
