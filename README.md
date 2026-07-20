<div align="center">

# 🎓 University Club & Event Management Platform

**The operating system for student organizations.**

A multi-tenant platform where every university club runs its own organization — members, committee, events, attendance, certificates, analytics, public page — with **hard data isolation**, **security-first** design, and **PDPA privacy** built into every feature.

[![Status](https://img.shields.io/badge/status-Phase%202%20nearly%20complete-22c55e?style=flat-square)](#-current-status)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2016-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Backend](https://img.shields.io/badge/backend-NestJS%2010-e0234e?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![Database](https://img.shields.io/badge/db-PostgreSQL%2016-4169e1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![ORM](https://img.shields.io/badge/orm-Prisma%205-2d3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io)
[![Tests](https://img.shields.io/badge/tests-backend%20101%20unit%20%2B%20327%20e2e%20·%20frontend%20154-blue?style=flat-square&logo=vitest&logoColor=white)](#-testing)
[![Isolation](https://img.shields.io/badge/tenant%20isolation-enforced-8b5cf6?style=flat-square&logo=shieldsdotio&logoColor=white)](#-security-architecture)

</div>

---

## 📖 What this project does

Most student organizations run on scattered tools — Google Forms for registration, spreadsheets for members, WhatsApp for coordination, shared drives for certificates. Data dies when the committee rotates. Attendance is counted by hand. Certificates get emailed one by one.

This platform collapses all of that into one secure application:

```
University
 ├── KICT      → own dashboard · own committee · own members · own events · own storage
 ├── IoTeams   → own dashboard · own committee · own members · own events · own storage
 ├── ACM       → own dashboard · own committee · own members · own events · own storage
 └── IEEE      → own dashboard · own committee · own members · own events · own storage

        ⛔ No organization can read another organization's data. Ever.
```

A club president signs up, creates an organization, invites a committee, publishes an event, collects registrations through a custom form, scans QR codes at the door, uploads certificates, watches the dashboard, and curates a public club page — **all without a single spreadsheet, all from a real Next.js UI.**

### 🔄 The event lifecycle it covers

```
Draft → Published → Registration → Waitlist → Event Day → QR Attendance → Certificates → Completed → Audit Trail
```

---

## ✨ Features

### 🔐 Authentication & Access
| | |
|---|---|
| 🔑 **JWT auth + refresh rotation** | Short-lived access tokens, hashed refresh tokens, revocable on logout |
| 🛡️ **argon2 password hashing** | No plaintext, no weak hashes |
| 👥 **Per-organization RBAC** | 9 roles resolved via `Membership.role` — a user can be President in one club and Participant in another |
| 🚧 **Three-guard chain** | `AuthGuard` → `TenantGuard` → `RolesGuard` on every protected route |

### 🏛️ Organization & People
| | |
|---|---|
| 🏢 **Organization management** | Logo, description, advisors, social links, storage quota, per-org branding/theming, settings |
| 🎖️ **Committee management** | President · VP · Secretary · Treasurer · Event Director · Committee · Volunteer · Advisor · Participant |
| 🧑‍🎓 **Member management** | Student ID, faculty, programme, intake · Active/Alumni status · committee history |

### 📅 Events & Participation
| | |
|---|---|
| 🎪 **Event management** | Full CRUD, banner, venue, capacity, lifecycle status (Draft → Published → Completed / Cancelled) |
| 📝 **Custom registration forms** | Build your own fields — replaces Google Forms |
| ✅ **Approval workflow** | Approve, reject, cancel |
| ⏳ **Waitlist + auto-promote** | A cancellation automatically promotes the next person in line |
| 📱 **QR attendance** | Signed **single-use** tokens · scanner endpoint · mark-absent · timestamped records |
| 💬 **Feedback + NPS** | Per-event NPS/content/organization/venue ratings, feeds analytics |

### 📜 Certificates & Files
| | |
|---|---|
| 🏆 **Certificate repository** | Committee uploads → private bucket · participant self-downloads |
| ⚙️ **Automatic generation** | Background job renders + issues certificates on attendance, no manual upload required |
| 🔗 **Signed URLs only** | No public paths. Short-lived URLs issued after RBAC + ownership checks |
| 🚦 **Gated by attendance** | Upload/generation validated against attendance, MIME type, size, and org storage quota |

### 🗂️ Club Operating System (Workspace)

| | |
|---|---|
| 📁 **File repository** | SOPs, reports, financial docs, meeting docs — private, category-tagged |
| 🗒️ **Meeting minutes** | Agenda items, action items, attendee roster, structured archive |
| 📦 **Asset management** | Club inventory — quantity, condition, location |
| 🤝 **Committee handover pack** | One-click PDF export of roster, recent minutes, assets, key files, upcoming events — for committee rotation |

### 🌐 Public Presence

| | |
|---|---|
| 🖼️ **Public club page** | `/club/[orgSlug]` — no auth required. Profile, upcoming events, photo gallery, achievements |
| 📷 **Gallery management** | Committee uploads/removes photos with captions, PNG/JPEG, 10MB cap |
| 🏅 **Achievements management** | Committee-curated award history — title, year, description |
| 📧 **Email notifications** | Approvals, reminders, waitlist promotion — background-queued |

### 📊 Insight & Compliance
| | |
|---|---|
| 📈 **Dashboard** | KPI cards, upcoming events, pending approvals, recent registrations, activity feed |
| 📊 **Analytics** | Attendance rate, certificate stats, registration/member-growth trends, faculty/programme demographics, committee activity, feedback trends |
| 🧾 **Audit logs** | Who · what · when — every sensitive action. SuperAdmin cross-tenant access is break-glass and always flagged |
| ⚖️ **PDPA by design** | Consent capture (purpose + version + timestamp) · versioned re-prompt on policy change · export my data · delete/anonymize account · never log personal data |

---

## 🔒 Security architecture

Security isn't a checklist item here — it's the reason the architecture looks the way it does.

| Layer | Guarantee |
|---|---|
| 🧱 **Tenant isolation** | Every tenant-owned row carries `organizationId`. A Prisma middleware asserts every tenant query is org-scoped and **throws** if it isn't |
| 🧪 **Proof, not promises** | Every feature ships with a test proving org A cannot reach org B's data |
| 🎭 **RBAC** | Per-org roles only — no global role leaks across tenants. Permission tiers centralized in `rbac/role-groups.ts`, mirrored on the frontend by tier helpers (`isCommittee`, etc.) |
| 🌐 **Nav-gated, not just route-gated** | Sidebar links hide by tier, but every page independently degrades to read-only for a direct URL visit — nav visibility and backend RBAC are always two separate, independently-correct gates |
| 🗄️ **Private storage** | S3/MinIO private buckets, signed URLs, MIME/size/quota validation on every upload |
| 🧼 **Input validation** | DTOs + `class-validator` at the edge, parameterized Prisma queries underneath, Zod schemas mirroring the same rules on the frontend |
| 🔐 **Secrets** | Env-only, Joi-validated at boot — the app refuses to start with a weak or missing JWT secret |
| 📜 **Audit** | Sensitive actions written transactionally alongside the change they describe |

> **Non-negotiable rule #1:** *Tenant isolation is sacred.* Full detail → [`docs/security.md`](docs/security.md)

---

## 🧰 Tech stack

<div align="center">

| Layer | Technology |
|---|---|
| 🖥️ **Frontend** | Next.js 16 (App Router) · TypeScript 5 · React 19 · Tailwind CSS v4 · shadcn/ui (Base UI) · Lucide · React Hook Form + Zod · TanStack Query/Table · Zustand · Recharts · Motion · Vitest + React Testing Library |
| ⚙️ **Backend** | NestJS 10 (modular) · REST · Passport JWT |
| 🗃️ **ORM** | Prisma 5 |
| 🐘 **Database** | PostgreSQL 16 |
| ⚡ **Cache / queues** | Redis 7 (BullMQ — certificate generation, email notifications) |
| 📦 **File storage** | S3-compatible — MinIO (dev) · S3/R2 (prod) |
| 🔏 **Auth** | Custom JWT + per-org RBAC · argon2 |
| 🧪 **Testing** | Jest + Supertest (backend) · Vitest + React Testing Library (frontend) · Playwright (live verification) |
| 🚀 **Deploy** | Frontend → Vercel · Backend + Postgres + MinIO + Redis → Docker Compose |

</div>

### 🗂️ Data model

`User` · `RefreshToken` · `Organization` · `Membership` · `Event` · `RegistrationForm` · `FormField` · `Registration` · `Attendance` · `Certificate` · `ConsentRecord` · `AuditLog` · `OrgFile` · `MeetingMinutes` · `Asset` · `GalleryPhoto` · `Achievement` · `FeedbackResponse`

Full schema → [`docs/database.md`](docs/database.md)

---

## 📌 Current status

> **Phase 1 — Foundation Release: ✅ complete**, backend and frontend both. **Phase 2 — Organization Workspace: 🔨 nearly complete** — every item shipped except the Committee Handover Pack frontend (backend endpoint already live).

### Phase 1 — Foundation Release

| # | Feature | Backend | Frontend |
| --- | --- | --- | --- |
| 1 | Authentication (JWT + refresh, argon2) | ✅ | ✅ |
| 2 | Organization management | ✅ | ✅ |
| 3 | Committee management + RBAC | ✅ | ✅ |
| 4 | Member management | ✅ | ✅ |
| 5 | Event management | ✅ | ✅ |
| 6 | Registration (custom forms, approval, waitlist) | ✅ | ✅ |
| 7 | QR attendance | ✅ | ✅ |
| 8 | Certificate repository | ✅ | ✅ |
| 9 | Basic dashboard | ✅ | ✅ |
| 10 | Audit logs | ✅ | ✅ |
| 11 | Basic PDPA (consent, export, delete) | ✅ | ✅ |

### Phase 2 — Organization Workspace

| # | Feature | Backend | Frontend |
| --- | --- | --- | --- |
| 1 | Analytics | ✅ | ✅ |
| 2 | File repository | ✅ | ✅ |
| 3 | Meeting minutes | ✅ | ✅ |
| 4 | Asset management | ✅ | ✅ |
| 5 | Public club page | ✅ | ✅ |
| 6 | Gallery management | ✅ | ✅ |
| 7 | Achievements management | ✅ | ✅ |
| 8 | Email notifications | ✅ (background job) | — *(no UI needed, transactional)* |
| 9 | Certificate generator (automatic) | ✅ (background job) | — *(no UI needed, automatic)* |
| 10 | Branding & themes | ✅ | ✅ |
| 11 | Event feedback + NPS | ✅ | ✅ |
| 12 | Committee handover pack | ✅ | 🔨 next up |
| 13 | Consent-versioned re-prompt | ✅ | ✅ |

### 🚧 In progress

| Item | Status |
|---|---|
| 🤝 **Committee Handover Pack frontend** | 📝 Design spec in progress — last item closing out Phase 2 |
| 🔮 **Phase 3** | Not yet scoped |

---

## 🗺️ Roadmap

Three phases. Each ships a usable product. Ordering within a phase is dependency-first.

### ✅ Phase 1 — Foundation Release *(complete)*

The complete end-to-end participant journey with a security and privacy baseline.
> Auth · Organizations · Committee/RBAC · Members · Events · Registration · QR Attendance · Certificates · Dashboard · Audit Logs · Basic PDPA

### 🔨 Phase 2 — Organization Workspace *(nearly complete)*

Turns the platform from event tooling into a club's operating system.

- 📊 **Analytics** — attendance rate, member growth, faculty/programme distribution, registration trends, certificate downloads, committee activity ✅
- 📁 **File repository** — org document storage (SOPs, reports) ✅
- 🗒️ **Meeting minutes** — structured minutes + archive ✅
- 📦 **Asset management** — club inventory ✅
- 🌐 **Public club page** — upcoming events, gallery, achievements ✅
- 📧 **Email notifications** — approvals, reminders, waitlist promotion ✅
- 🏅 **Certificate generator** — automatic generation (upgrade from upload-only) ✅
- 🎨 **Branding & themes** — full per-org theming ✅
- 💬 **Event feedback + NPS** — feeds analytics; can gate certificate release ✅
- 🤝 **Committee handover pack** — export org knowledge on rotation 🔨
- 🔁 **Consent-versioned re-prompt** — re-collect consent on policy change ✅

### 🔮 Phase 3 — Smart Campus Platform

Institutional scale and intelligence.

- 🎫 **University SSO** — SAML/OIDC
- 🔢 **MFA** — TOTP enforced for privileged roles
- 🤖 **AI assistant** — in-app help + event/committee Q&A
- 📄 **AI report generation** — auto post-event and yearly reports
- 📱 **Mobile app** — native, optimized for QR attendance + lookup
- 💳 **Payment gateway** — paid events, membership fees
- 💰 **Budget & sponsor management**
- 📉 **Advanced analytics** — cross-event, cohort, predictive
- 🔍 **OCR & automation** — document/receipt extraction

Full detail → [`docs/roadmap.md`](docs/roadmap.md)

---

## 🚀 Getting started

### Prerequisites
- Node.js 20+
- Docker + Docker Compose

### 1️⃣ Start infrastructure

```bash
docker compose up -d      # PostgreSQL 16 · MinIO · Redis 7 · Mailpit (dev email)
```

| Service | URL |
|---|---|
| PostgreSQL | `localhost:5432` |
| MinIO API | `localhost:9000` |
| MinIO console | `localhost:9001` |
| Redis | `localhost:6379` |
| Mailpit (dev email UI) | `localhost:8025` |

### 2️⃣ Configure and run the backend

```bash
cd backend
cp .env.example .env
```

Set real secrets — the app validates env at boot with Joi and **refuses to start** if `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are missing, under 16 characters, or identical to each other.

```env
PORT=3001
DATABASE_URL=postgresql://ucm:ucm_dev_password@localhost:5432/ucm?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=<min 16 chars>
JWT_REFRESH_SECRET=<min 16 chars, different from access>
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=7d
ATTENDANCE_TOKEN_SECRET=<change me>
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio_dev_password
S3_BUCKET=ucm-dev
```

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev          # → http://localhost:3001
```

### 3️⃣ Configure and run the frontend

```bash
cd frontend
npm install
npm run dev                # → http://localhost:3000
```

The frontend reads `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`).

---

## 🧪 Testing

Built test-first: **red → green → refactor**. Tenant-isolation tests are mandatory for every backend feature — a feature isn't done until there's a test proving org A can't touch org B.

```bash
cd backend
npm test           # unit specs — 21 suites / 101 tests
npm run test:e2e   # e2e specs — 66 suites / 327 tests (needs docker compose up)

cd ../frontend
npm test -- --run  # unit + component specs — 34 suites / 154 tests
npx tsc --noEmit   # typecheck
npm run build      # production build
```

Isolation coverage lives in `tenant-isolation`, `events-isolation`, `memberships-isolation`, `registrations-isolation`, `attendance-isolation`, and `certificates-isolation` e2e specs. Every frontend feature additionally gets a live-verification pass against the running dev stack (Playwright) before it ships, covering both light and dark themes and both a committee and a non-committee test account.

---

## 🔌 API surface

REST, org-scoped by URL. Every tenant route lives under `/organizations/:orgId/…` — the scope is in the path, enforced by the guard chain, and asserted again at the Prisma layer.

| Area | Routes |
|---|---|
| 🔑 Auth | `POST /auth/register` · `login` · `refresh` · `logout` · `GET /auth/me` |
| 🏢 Organizations | `GET\|POST /organizations` · `GET\|PATCH /organizations/:orgId` · `PATCH /organizations/:orgId/settings` · `POST /:orgId/logo` · `POST /:orgId/banner` |
| 👥 Members | `GET\|POST /organizations/:orgId/members` · `GET /members/me` · `PATCH /:membershipId` · `PATCH /:membershipId/role` · `DELETE /:membershipId` |
| 📅 Events | `GET\|POST /organizations/:orgId/events` · `GET\|PATCH\|DELETE /:eventId` · `POST /:eventId/publish` · `complete` · `cancel` |
| 📝 Registrations | `/events/:eventId/registration-form` · `GET\|POST /events/:eventId/registrations` · `GET /registrations/me` · `POST /:registrationId/cancel` · `reject` |
| 📱 Attendance | `POST /events/:eventId/attendance/scan` · `GET /attendance/me` · `POST /:attendanceId/absent` |
| 🏆 Certificates | `POST /events/:eventId/certificates` · `GET /certificates/me` · `GET /:certificateId/download` · `DELETE /:certificateId` |
| 💬 Feedback | `POST /events/:eventId/feedback` · `GET /organizations/:orgId/feedback-trends` |
| 📁 Files | `GET\|POST /organizations/:orgId/files` · `GET /:fileId/download` · `DELETE /:fileId` |
| 🗒️ Minutes | `GET\|POST /organizations/:orgId/minutes` · `GET\|PATCH\|DELETE /:minutesId` |
| 📦 Assets | `GET\|POST /organizations/:orgId/assets` · `PATCH\|DELETE /:assetId` |
| 📷 Gallery | `GET\|POST /organizations/:orgId/gallery` · `DELETE /:photoId` |
| 🏅 Achievements | `GET\|POST /organizations/:orgId/achievements` · `GET\|PATCH\|DELETE /:achievementId` |
| 🌐 Public | `GET /public/organizations/:orgSlug` · `/gallery` · `/achievements` — no auth |
| 📊 Analytics | `GET /organizations/:orgId/analytics/{overview,certificates,trends,demographics,committee-activity,feedback,feedback-trends}` |
| 📈 Dashboard | `GET /organizations/:orgId/dashboard` |
| 🤝 Handover | `GET /organizations/:orgId/handover` — streams a PDF |
| 🧾 Audit | `GET /organizations/:orgId/audit-logs` |
| ⚖️ PDPA | `GET /me/consents` · `GET /me/export` · `DELETE /me` |

---

## 📂 Repository layout

```
university-club-management/
├── 📄 CLAUDE.md              # build direction + non-negotiable rules
├── 🎨 design.md              # design system
├── 🐳 docker-compose.yml     # Postgres · MinIO · Redis · Mailpit
├── 📚 docs/
│   ├── planning.md           # vision, problem, modules
│   ├── roadmap.md            # three-phase plan
│   ├── database.md           # schema
│   ├── security.md           # auth, RBAC, isolation, PDPA, audit
│   ├── uiux.md                # frontend design decisions per slice
│   ├── current-context.md    # per-slice build log (backend + frontend)
│   └── superpowers/{specs,plans}/  # per-feature design specs + implementation plans
├── ⚙️ backend/                # NestJS
│   ├── prisma/                # schema + migrations
│   ├── src/
│   │   ├── auth/  organizations/  memberships/  events/
│   │   ├── registrations/  attendance/  certificates/  feedback/
│   │   ├── files/  minutes/  assets/  gallery/  achievements/  public/
│   │   ├── analytics/  dashboard/  audit/  pdpa/  notifications/  handover/
│   │   ├── rbac/  tenancy/  storage/  config/
│   └── test/                  # e2e specs, isolation-first
└── 🖥️ frontend/                # Next.js 16 (App Router)
    ├── app/(auth)/            # login, register, consent
    ├── app/(app)/[orgSlug]/   # dashboard, events, members, attendance, certificates,
    │                          # feedback, analytics, workspace (files/minutes/assets),
    │                          # public-page (gallery/achievements), settings
    ├── app/club/[orgSlug]/    # public club page — no auth
    ├── components/            # per-domain UI, shadcn/ui primitives under ui/
    ├── features/               # per-domain data hooks + Zod schemas
    └── lib/  hooks/  types/  styles/
```

---

## 🧭 How this project is built

- 🧠 **Brainstorm → spec → plan → implement.** Every feature gets a design spec and an implementation plan in `docs/superpowers/specs/` and `docs/superpowers/plans/` **before** any code.
- 🔴🟢♻️ **TDD per feature.** Red, green, refactor. Isolation tests mandatory on the backend; every frontend feature ships with unit tests and a live-verification pass against the running dev stack.
- 📝 **Docs track reality.** `database.md`, `security.md`, `uiux.md`, and `current-context.md` are updated as features land — they document the version being built, never an imaginary future system.
- 📶 **Phases, in order.** No pulling Phase 2/3 work forward without a reason. Frontend is built slice-by-slice, one feature at a time, each merged to `main` only after its own tests and live verification pass.

---

## 💡 Why it matters

This isn't a portfolio CRUD app. It's an exercise in the things that are genuinely hard in real systems:

🏗️ enterprise architecture · 🏢 multi-tenancy · 🎭 role-based access control · 🔐 secure authentication · ⚖️ privacy-by-design · 📊 analytics · 📦 secure file management · 🗄️ scalable database design · 🖥️ a real, RBAC-aware frontend on top of all of it

And it targets a real problem, for real student organizations, that real spreadsheets are currently failing to solve.

---

<div align="center">

**Built with security, privacy, and student organizations in mind.**

</div>
