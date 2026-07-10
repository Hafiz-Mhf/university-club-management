# Roadmap

Three phases. Build incrementally — each phase ships a usable product. Scope
is fixed per the finalized plan; ordering within a phase is by dependency.

---

## Phase 1 — Foundation Release (MVP)

The complete end-to-end participant journey with security and privacy baseline.

**Build order (dependency-first):**

1. **Authentication** — email/password, JWT + refresh, argon2 hashing.
2. **Organization Management** — create org, settings, logo, branding fields.
3. **Committee Management + RBAC** — Membership, per-org roles, guards,
   permission matrix.
4. **Member Management** — member profiles, active/alumni, committee history.
5. **Event Management** — event CRUD, lifecycle status, banner.
6. **Registration** — custom forms (FormField), approval workflow, waitlist
   (+ auto-promote on cancel).
7. **QR Attendance** — signed single-use tokens, scanner endpoint, attendance
   records.
8. **Certificate Repository** — committee upload → private bucket; participant
   self-download via signed URL.
9. **Basic Dashboard** — KPI cards, upcoming events, pending approvals,
   recent registrations, activity feed.
10. **Audit Logs** — sensitive-action logging + break-glass alerts.
11. **Basic PDPA** — consent capture, export my data, delete/anonymize request.

**Exit criteria:** a club can register, run an event, take QR attendance, and
distribute certificates — with tenant isolation tests passing and PDPA baseline
working.

---

## Phase 2 — Organization Workspace

Turns the platform from event tooling into a club's operating system.

- **Analytics** — attendance rate, member growth, faculty/programme
  distribution, registration trends, certificate downloads, committee activity.
- **File Repository** — org document storage (SOPs, reports).
- **Meeting Minutes** — structured minutes + archive.
- **Asset Management** — inventory of club assets.
- **Public Club Page** — upcoming events, gallery, contacts, achievements,
  public registration links.
- **Email Notifications** — approvals, reminders, waitlist promotion.
- **Certificate Generator** — automatic certificate generation (upgrade from
  upload-only).
- **Branding & Themes** — full per-org theming (primary color, logo, banner).
- **Event Feedback + NPS** — feeds analytics; can gate certificate release.
- **Committee Handover Pack** — export org knowledge on committee rotation.
- **Consent-versioned re-prompt** — re-collect consent on policy change.

---

## Phase 3 — Smart Campus Platform

Institutional scale and intelligence.

- **University SSO** — SAML/OIDC integration.
- **MFA** — TOTP enforced for privileged roles.
- **AI Assistant** — in-app help + event/committee Q&A.
- **AI Report Generation** — auto post-event and yearly reports.
- **Mobile App** — native, optimized for QR attendance + lookup.
- **Payment Gateway** — paid events, membership fees.
- **Budget & Sponsor Management** — event expenses, sponsors, budgets.
- **Advanced Analytics** — cross-event, cohort, predictive.
- **OCR & Automation** — document/receipt extraction, workflow automation.

---

## Guiding Principle

Do not document or build an imaginary future system. Build the next version.
Keep `docs/` synced with what is actually implemented as each phase lands.
