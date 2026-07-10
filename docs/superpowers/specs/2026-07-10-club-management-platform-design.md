# University Club & Event Management Platform — Design Spec

**Date:** 2026-07-10
**Status:** Approved — ready for implementation planning

---

## 1. Vision

A multi-tenant platform where every university club/society manages its own
organization independently — members, committee, events, participants,
certificates, analytics — with hard data isolation between organizations,
security-first design, and PDPA privacy baked into every feature.

It is the operating system for student organizations, not just an event
registration form.

---

## 2. Finalized Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 18 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Lucide, React Hook Form + Zod, TanStack Query + Table, Zustand, Recharts/Tremor, Motion |
| Backend | **NestJS** (modular) + REST |
| ORM | **Prisma** |
| Database | **PostgreSQL** |
| Cache | **Redis** — used for caching, rate-limiting, and analytics acceleration (lands Phase 2). Dev container from the start |
| File storage | **S3-compatible** — MinIO (dev) / AWS S3 or Cloudflare R2 (prod). Private buckets + short-lived signed URLs |
| Auth | Custom JWT + RBAC (email/password). MFA + University SSO deferred to later phases |
| Deploy | Frontend → Vercel. Backend + Postgres + MinIO → Docker Compose (dev); backend host of choice (prod) |

---

## 3. Architecture

```
Next.js 18 (frontend/)
      │  HTTPS REST, JWT bearer
      ▼
NestJS API (backend/)
      ├─ AuthGuard      → JwtStrategy (verify token)
      ├─ RolesGuard     → @Roles() decorator, per-org RBAC
      ├─ TenantGuard    → resolves caller org from Membership, injects org scope
      ├─ Prisma         → PostgreSQL
      └─ StorageService → S3-compatible (private buckets, signed URLs)
```

### Multi-tenancy isolation (app-layer, defense in depth)

1. Every tenant-owned row carries `organizationId`.
2. `TenantGuard` resolves the caller's active organization from their
   `Membership` + JWT and injects a scoped request context.
3. A Prisma middleware/extension asserts that **every** query against a
   tenant-owned model includes the org filter. A missing filter throws —
   it fails loud instead of silently leaking cross-tenant data.
4. Isolation is covered by mandatory automated tests (org A must never read
   org B).

`SuperAdmin` cross-tenant access is allowed but **always audit-logged and
flagged** (break-glass).

---

## 4. Backend Module Map (NestJS)

`auth`, `organizations`, `memberships` (committee roles + history),
`events`, `registrations`, `attendance` (QR), `certificates`, `dashboard`,
`audit`, `pdpa`, and a shared `storage` module. Each module: controller /
service / DTOs / Prisma access. Guards are cross-cutting.

---

## 5. Core Data Model (Phase 1)

- **User** — global identity: email, hashed password (argon2/bcrypt), MFA secret (nullable).
- **Organization** — logo, description, advisors, socials, storage quota, settings, primaryColor.
- **Membership** — join(User ↔ Organization) + `role` + `status` (active/alumni) + committee history. **RBAC role is per-organization, not global.**
- **Event** — org-scoped: banner, venue, capacity, dates, lifecycle status.
- **RegistrationForm / FormField** — custom registration fields per event.
- **Registration** — participant answers, status (pending / approved / waitlisted), consent snapshot.
- **Attendance** — registration + signed QR token + scannedAt + status.
- **Certificate** — event/participant + private storage key. Owner downloads via signed URL.
- **ConsentRecord** — user + purpose + policy version + timestamp (PDPA).
- **AuditLog** — actor, action, target, organizationId, timestamp, IP/device (optional).

Full schema detail lives in `docs/database.md`.

---

## 6. Key Flows

### QR Attendance
On registration approval, the server mints a **signed, single-use token**
(HMAC) per registration, rendered as a QR in the participant's event pass.
The committee scanner POSTs the token → server verifies signature +
not-already-scanned + event time window → writes `Attendance`. Tokens are
signed so they cannot be forged, and single-use so they cannot be replayed.

### Certificate Repository
Committee uploads a certificate PDF → **private** bucket (no public read).
Participant requests their certificate → server checks ownership/role →
returns a 5-minute signed URL. No public storage paths, ever. (Automatic
certificate generation is deferred to Phase 2.)

### PDPA Baseline (Phase 1)
- Consent captured with timestamp + policy version at registration.
- "Export my data" and "delete / anonymize request" endpoints.
- Audit log on every sensitive action.
- Encryption at rest (DB + bucket), HTTPS in transit, argon2/bcrypt hashing,
  secure session/JWT handling.

---

## 7. RBAC — Role Hierarchy

```
SuperAdmin > UniversityAdmin > Advisor > President > VP >
Secretary / Treasurer / EventDirector > Committee > Volunteer > Participant
```

Roles resolve **per organization** via `Membership`. `@Roles()` + `RolesGuard`
gate endpoints. The full permission matrix lives in `docs/security.md`.

---

## 8. Testing Strategy

- **Backend:** Jest unit tests (services, guards) + e2e (Supertest) per module.
  **Tenant-isolation tests are mandatory** — assert org A cannot read/write org B.
- **Frontend:** component tests + Playwright for critical journeys
  (register → approve → QR → attendance → certificate).
- TDD per feature: red → green → refactor.

---

## 9. Roadmap (finalized — 3 phases)

**Phase 1 — Foundation Release:** Authentication, Organization Management,
Committee Management, RBAC, Event Management, Registration, QR Attendance,
Certificate Repository, Basic Dashboard, Audit Logs, Basic PDPA.

**Phase 2 — Organization Workspace:** Analytics, File Repository, Meeting
Minutes, Asset Management, Public Club Page, Email Notifications, Certificate
Generator, Branding & Themes.

**Phase 3 — Smart Campus Platform:** University SSO, AI Assistant, AI Report
Generation, Mobile App, Payment Gateway, Budget & Sponsor Management, Advanced
Analytics, OCR & Automation.

Detail + ordering in `docs/roadmap.md`.

---

## 10. Added Feature Recommendations (accepted)

- **Waitlist auto-promote** — when an approved participant cancels, the next
  waitlisted participant is promoted and notified.
- **Event feedback + NPS** (Phase 2) — feeds analytics; can gate certificate
  release (attend + feedback → certificate).
- **Committee handover pack** (Phase 2) — export org knowledge on committee
  rotation; solves the "data lost on handover" problem.
- **Break-glass audit alerts** (Phase 1) — SuperAdmin cross-tenant access is
  always logged and flagged.
- **Consent-versioned re-prompt** (Phase 2) — re-collect consent when the
  privacy policy version changes.

---

## 11. Repository Layout

```
university-club-management/
├── CLAUDE.md              # build direction for future sessions
├── design.md              # design system (distilled from design-direction-v1)
├── docs/
│   ├── planning.md
│   ├── database.md
│   ├── security.md
│   ├── roadmap.md
│   ├── doc-structure.md
│   ├── design-direction-v1.md
│   └── superpowers/specs/2026-07-10-club-management-platform-design.md
├── frontend/             # Next.js 18
└── backend/              # NestJS
```
