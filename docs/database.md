# Database Design

**Engine:** PostgreSQL · **ORM:** Prisma · **Isolation:** app-layer multi-tenancy

---

## 1. Multi-Tenancy Model

Every tenant-owned table carries an `organizationId` foreign key. The
application enforces isolation at two layers:

1. **TenantGuard** injects the caller's active `organizationId` (resolved from
   their `Membership`) into request scope.
2. A **Prisma middleware/extension** asserts every query against a
   tenant-owned model includes the `organizationId` filter. Missing filter →
   throw. Fails loud, never leaks.

`User`, `ConsentRecord`, and `AuditLog` are the only models that are not
strictly org-owned (User is global; AuditLog stores `organizationId` but is
written by every module; ConsentRecord is user+purpose scoped).

---

## 2. Entities (Phase 1)

### User (global identity)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| email | string, unique | login |
| passwordHash | string | argon2/bcrypt |
| fullName | string | |
| mfaSecret | string, nullable | Phase 3 SSO/MFA |
| createdAt / updatedAt | timestamp | |
| deletedAt | timestamp, nullable | soft delete / anonymize |

### Organization (tenant)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| name | string | |
| slug | string, unique | public URL |
| description | text | |
| logoKey | string, nullable | private storage key |
| advisors | jsonb | list |
| socialLinks | jsonb | |
| storageQuotaMb | int | default quota |
| primaryColor | string | branding |
| settings | jsonb | |
| createdAt / updatedAt | timestamp | |

### Membership (User ↔ Organization + RBAC)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| userId | uuid (FK → User) | |
| organizationId | uuid (FK → Organization) | |
| role | enum Role | **per-org role — the RBAC source of truth** |
| status | enum (active, alumni) | |
| studentId, faculty, programme, intake, phone | string | member profile |
| committeeHistory | jsonb | past roles + terms |
| joinedAt | timestamp | |
| — | unique(userId, organizationId) | one membership per org |

### Event (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | tenant scope |
| title | string | required |
| description | text, nullable | |
| venue | string, nullable | |
| startAt / endAt | timestamp | attendance window; `endAt` must be after `startAt` |
| capacity | int, nullable | `null` = unlimited; capacity enforcement deferred to the Registration module |
| bannerKey | string, nullable | private storage key; upload flow deferred to the storage module |
| status | enum `EventStatus` (DRAFT, PUBLISHED, COMPLETED, CANCELLED) | lifecycle, default `DRAFT` |
| createdByUserId | uuid, nullable | creator's user id (plain column, no FK relation) |
| createdAt / updatedAt | timestamp | |
| — | `@@index([organizationId])` | tenant-scoped queries |
| — | `@@index([organizationId, status])` | list/status filtering (e.g. hiding DRAFT from non-managers) |

### RegistrationForm / FormField (shipped)
`RegistrationForm` (1:1 Event) → many `FormField` (label, type, required,
options jsonb, order). Lets committees replace Google Forms with custom fields.
Neither table carries its own `organizationId` — isolation is enforced via an
org-scoped `Event` lookup (`findFirst({ id: eventId, organizationId })`)
before every read/write, since `Event.organizationId` never changes after
creation.

### Registration (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| eventId | uuid (FK → Event) | |
| organizationId | uuid (FK → Organization) | denormalized for scope |
| userId | uuid (FK → User) | **non-nullable** — every registrant is an authenticated `User`, auto-enrolled as a `PARTICIPANT` member on registration; this module has no guest/non-account registration path |
| answers | jsonb, nullable | form responses, allowlist-projected onto the form's field ids before storage |
| status | enum `RegistrationStatus` (`PENDING, APPROVED, WAITLISTED, REJECTED, CANCELLED`) | `PENDING` reserved for a future manual-review/payment flow, unused by this module; default `APPROVED` |
| consentRecordId | uuid (FK → ConsentRecord), unique | consent snapshot, 1:1 |
| createdAt / updatedAt | timestamp | |
| — | `@@unique([eventId, userId])` | one registration per user per event |
| — | `@@index([organizationId])` | tenant-scoped queries |
| — | `@@index([eventId, status])` | capacity counts + waitlist FIFO promotion |

### Attendance
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| registrationId | uuid (FK, unique) | one per registration |
| eventId | uuid (FK) | |
| organizationId | uuid (FK) | |
| qrTokenHash | string | HMAC-signed, single-use |
| scannedAt | timestamp, nullable | |
| status | enum (registered, present, absent) | |
| scannedBy | uuid (FK → User), nullable | committee scanner |

### Certificate
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| eventId | uuid (FK) | |
| organizationId | uuid (FK) | |
| userId | uuid (FK → User) | owner |
| storageKey | string | **private** bucket key |
| uploadedBy | uuid (FK → User) | committee |
| createdAt | timestamp | |

### ConsentRecord (PDPA) (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| userId | uuid (FK → User) | **non-nullable** — same reason as `Registration.userId`: every consent is captured for an authenticated `User`, no anonymous/guest path |
| purpose | string | e.g. event-registration |
| policyVersion | string | for consent re-prompt |
| grantedAt | timestamp | |
| ipAddress | string, nullable | |

### AuditLog
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK), nullable | null for platform-level actions |
| actorUserId | uuid (FK → User), nullable | |
| action | string | e.g. certificate.download |
| targetType / targetId | string | |
| metadata | jsonb | |
| ipAddress / userAgent | string, nullable | |
| isBreakGlass | boolean | SuperAdmin cross-tenant flag |
| createdAt | timestamp | |

---

## 3. Relationships (summary)

```
User 1─* Membership *─1 Organization
Organization 1─* Event 1─1 RegistrationForm 1─* FormField
Event 1─* Registration 1─1 Attendance
Event 1─* Certificate *─1 User
User 1─* ConsentRecord
Organization 1─* AuditLog
```

---

## 4. Indexing & Constraints

- Index every `organizationId` (all tenant queries filter on it).
- `unique(userId, organizationId)` on Membership.
- `unique(registrationId)` on Attendance.
- `@@index([organizationId])` + `@@index([organizationId, status])` on Event
  (shipped) — the latter backs status-filtered list/dashboard queries.
- Soft-delete via `deletedAt` on User for PDPA anonymization; hard-delete jobs
  configurable per retention policy.

---

## 5. Phase 2+ Additions (not built yet)

FileRepository, MeetingMinutes, Asset, PublicPageConfig, FeedbackResponse,
Budget, Sponsor, Payment — each org-scoped, added when their phase lands.
Keep this doc synced as models are implemented.
