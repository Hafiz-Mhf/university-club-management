# Product

## Register

product

## Users

- **Participants** — university students, browsing on mobile as often as desktop. Job: find events, register (sometimes fill a custom form), get approved/waitlisted, show up (QR check-in), later download certificates. Low patience for friction — this is a side activity, not their job.
- **Committee** (President/VP/Secretary/Treasurer/Event Director/Committee/Volunteer) — runs one org's events day-to-day: builds registration forms, approves/rejects/waitlists, scans attendance at the door, uploads certificates, reads analytics. RBAC-gated per role.
- **Advisor / University Admin / Super Admin** — oversight and cross-tenant break-glass access, always audited. Not the primary daily user.

## Product Purpose

Replace the scattered Google Forms + spreadsheets + email stack student orgs currently use to run events, with one secure, multi-tenant platform: registration, approval/waitlist, QR attendance, certificate distribution, analytics — per organization, with hard data isolation between orgs. Success = committees stop maintaining parallel spreadsheets, and participants get a registration-to-certificate flow that's faster and less error-prone than a Google Form.

## Brand Personality

Modern SaaS, not a university portal — Notion / Linear / Vercel / Supabase register. Precise, calm, trustworthy (this handles personal data and certificates). Dark mode from day one. Per-org branding (primary color, logo, banner) layered on top of a consistent system.

## Anti-references

- Not a university portal (legacy .edu admin-system look: dense tables, primary-blue chrome, Times New Roman energy).
- Not a Google Forms clone — the whole point is to be a step up from that.
- Not generic dashboard-template SaaS (interchangeable hero-metric cards, no identity per org).

## Design Principles

1. **Desktop-first for admin, mobile-optimized for participant-facing flows** — QR attendance and event registration/lookup are used standing up, on a phone.
2. **Security and privacy are UX, not just backend** — consent, data collection, and file access states should read as trustworthy in the interface, not bolted on.
3. **Replace-a-spreadsheet clarity** — every screen should be legible enough that a first-time committee volunteer with no training can use it correctly.
4. **Low-friction for participants, high-control for committee** — the participant side optimizes for speed/minimal taps; the committee side optimizes for precision and auditability.
5. **Per-org identity within one consistent shell** — branding varies, interaction patterns and information architecture do not.

## Accessibility & Inclusion

WCAG-informed baseline already committed in `design.md`: body text contrast ≥4.5:1, large text/UI glyphs ≥3:1, 44×44px minimum touch targets, full keyboard accessibility, large forms broken into logical sections. QR scanner view: minimal chrome, large high-contrast targets. Carry this baseline into every critique/audit.
