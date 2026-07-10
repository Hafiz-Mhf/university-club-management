# CLAUDE.md — Build Direction

Guardrails and direction for building the **University Club & Event Management
Platform**. Read before implementing. Keep docs synced as features land.

---

## What we're building

A multi-tenant platform where every university club/society manages its own
organization independently — members, committee, events, participants,
certificates, analytics — with **hard data isolation** between organizations,
**security-first** design, and **PDPA privacy** baked into every feature.

Full vision → `docs/planning.md`. Design spec → `docs/superpowers/specs/2026-07-10-club-management-platform-design.md`.

---

## Stack (finalized — do not swap without discussion)

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 18 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Lucide, React Hook Form + Zod, TanStack Query + Table, Zustand, Recharts/Tremor, Motion |
| Backend | NestJS (modular) + REST |
| ORM | Prisma |
| Database | PostgreSQL |
| Cache | Redis (introduced when caching / rate-limiting / analytics land — Phase 2). Container stood up in dev from the start |
| File storage | S3-compatible — MinIO (dev) / S3 or R2 (prod). Private buckets + short-lived signed URLs |
| Auth | Custom JWT + RBAC (email/password). MFA + SSO later phases |
| Deploy | Frontend → Vercel · Backend + Postgres + MinIO → Docker Compose (dev) |

---

## Repository layout

```
university-club-management/
├── CLAUDE.md          # this file
├── design.md          # design system
├── docs/              # planning, database, security, roadmap, + references
├── frontend/          # Next.js 18
└── backend/           # NestJS
```

`frontend/` structure: `app/`, `components/{ui,dashboard,events,members,certificates,analytics}/`,
`features/`, `hooks/`, `lib/`, `services/`, `styles/`, `types/`.

`backend/` modules: `auth`, `organizations`, `memberships`, `events`,
`registrations`, `attendance`, `certificates`, `dashboard`, `audit`, `pdpa`,
shared `storage`. Each module: controller / service / DTOs / Prisma access.

---

## Non-negotiable rules

1. **Tenant isolation is sacred.** Every tenant-owned row has `organizationId`.
   `TenantGuard` injects scope; a Prisma middleware asserts every tenant query
   is org-scoped and **throws** if not. Every feature ships with a test proving
   org A cannot access org B. See `docs/security.md`.
2. **RBAC is per-organization**, resolved via `Membership.role` — never a global
   role. Gate endpoints with `@Roles()` + `RolesGuard`. Follow the permission
   matrix in `docs/security.md`.
3. **Files are private.** No public storage paths. Serve via signed URLs after
   RBAC + ownership checks. Validate MIME/size/quota on upload.
4. **PDPA by design.** Capture consent (purpose + version + timestamp). Support
   export + delete/anonymize. Log sensitive actions. Encrypt at rest + transit.
   Collect only necessary personal data. Never log personal data.
5. **Security baseline:** argon2/bcrypt hashing, JWT + refresh rotation, input
   validation via DTOs, parameterized Prisma queries, CORS locked, secrets in
   env only, least privilege everywhere.
6. **Audit everything sensitive.** SuperAdmin cross-tenant access is
   break-glass → always logged + flagged.

---

## How we work

- **Brainstorm → spec → plan → implement.** Specs live in `docs/superpowers/specs/`.
- **TDD per feature:** red → green → refactor. Tenant-isolation tests mandatory.
- **Iterative docs:** update `docs/database.md`, `docs/security.md`, and
  (later) `architecture.md` / `api.md` / `uiux.md` as features land. Do not
  document an imaginary future system — document the next version being built.
- **Phases:** build in roadmap order (`docs/roadmap.md`). Phase 1 = Foundation
  Release (auth, org, committee/RBAC, events, registration, QR, certificates,
  dashboard, audit, basic PDPA). Do not pull Phase 2/3 work forward without
  reason.

---

## Design

UI resembles a modern SaaS platform (Notion / Linear / Vercel / Supabase), not
a university portal. Full design system → `design.md`. Dark mode from day one.
Per-org branding (primary color, logo, banner). Desktop-first for admin;
mobile-optimized for QR attendance + participant lookup.
