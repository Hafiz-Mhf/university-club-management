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

### Attendance (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| registrationId | uuid (FK → Registration, unique) | one per registration |
| eventId | uuid (FK → Event) | |
| organizationId | uuid | denormalized for scope |
| status | enum `AttendanceStatus` (`REGISTERED, PRESENT, ABSENT`) | default `REGISTERED` |
| scannedAt | timestamp, nullable | set when status becomes `PRESENT` |
| scannedBy | uuid, nullable | committee/volunteer userId who scanned |
| createdAt | timestamp | |
| — | `@@index([organizationId])` | tenant-scoped queries |
| — | `@@index([eventId, status])` | attendance list/counts |

No `qrTokenHash` column: the QR token is stateless —
`base64url(attendanceId + "." + HMAC-SHA256(attendanceId, ATTENDANCE_TOKEN_SECRET))`,
verified by recomputing the HMAC. Single-use is enforced by the
`REGISTERED → PRESENT` compare-and-swap, not by storing/rotating a token
hash.

### Certificate (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| eventId | uuid (FK → Event) | |
| organizationId | uuid | denormalized for scope |
| userId | uuid (FK → User) | certificate owner (the participant) |
| storageKey | string | deterministic **private** bucket key — `certificates/{organizationId}/{eventId}/{userId}.pdf` |
| fileSizeBytes | int | size of the uploaded PDF; summed live for per-org quota (no running-counter column) |
| uploadedByUserId | uuid | committee member who uploaded (plain column, no FK relation) |
| createdAt | timestamp | |
| — | `@@unique([eventId, userId])` | one certificate per person per event this phase |
| — | `@@index([organizationId])` | tenant-scoped queries |

`Certificate` is in `TENANT_SCOPED_MODELS` (same as Registration/Attendance),
so the Prisma tenant-scope middleware asserts every filtering read is
org-scoped. The `storageKey` is deterministic and shared across every upload
attempt for the same event+user — no title/type field and no multiple
certificates per event, so a delete-then-reupload overwrites the same MinIO
key. Per-org storage quota is enforced with a live
`SUM(fileSizeBytes)` aggregate (`certificate.aggregate`) at upload time rather
than a running counter on `Organization`; certificate volumes are small (one
row per person per event) so the aggregate is cheap and never drifts.

### CertificateDownload (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| certificateId | uuid (FK → Certificate) | |
| userId | uuid | the downloading actor — participant self-download or committee download-by-id; plain column, no FK relation (matches `Certificate.uploadedByUserId`'s convention) |
| downloadedAt | timestamp | |
| — | `@@index([certificateId])` | |

Not a tenant-scoped model — queried through `certificate: { organizationId }`
(a relation filter), written by known `certificateId` on every signed-URL
issuance from `CertificatesService.findMine`/`download`. One row per
issuance, not per unique downloader — a certificate downloaded five times
by the same person is five rows.

### OrgFile (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| title | string | user-provided label, distinct from the original filename |
| category | enum (`SOP`, `REPORT`, `FINANCIAL`, `MEETING`, `OTHER`) | display/filter tag, not an access-control boundary |
| storageKey | string | `org-files/{organizationId}/{randomUUID()}.{ext}` — unique per upload, never reused or overwritten |
| originalFilename | string | as submitted by the uploader |
| mimeType | string | validated against a fixed allowlist at upload time |
| fileSizeBytes | int | counted toward the org's shared storage quota alongside `Certificate.fileSizeBytes` |
| uploadedByUserId | uuid | plain column, no FK relation (matches `Certificate.uploadedByUserId`'s convention) |
| createdAt | timestamp | |
| — | `@@index([organizationId])`, `@@index([organizationId, category])` | |

`OrgFile` **is** in `TENANT_SCOPED_MODELS` (unlike `CertificateDownload`) —
list/filter reads against it are genuine `findMany` calls the tenant-scope
middleware is meant to guard. No version history: re-uploading a "new
version" of a document creates a brand-new row; the old row must be
explicitly deleted if only one copy should remain visible.

### MeetingMinutes (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| title | string | |
| meetingDate | timestamp | |
| attendeeMembershipIds | json | `string[]` of `Membership.id`s, validated against real ACTIVE-org memberships at create/update time |
| agendaItems | json | `Array<{ topic: string; notes: string }>` |
| actionItems | json | `Array<{ task: string; owner?: string }>` — no status field, text record only |
| createdByUserId | uuid | plain column, no FK relation |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| — | `@@index([organizationId])` | |

`MeetingMinutes` **is** in `TENANT_SCOPED_MODELS` (same reasoning as
`OrgFile`) — the archive/list endpoint issues a genuine org-scoped
`findMany`. Not tied to `Event` — standalone org-level records. No join
table for attendees: stored as a validated `Json` array of Membership ids,
matching the `Json`-for-structured-non-relational-data convention already
used by `Organization.advisors`/`socialLinks`, `Membership.committeeHistory`,
and `Registration.answers`.

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
