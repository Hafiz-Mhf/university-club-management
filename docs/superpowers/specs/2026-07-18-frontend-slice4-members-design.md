# Frontend Slice 4 — Members (Design)

Status: approved, pending write-up review
Depends on: Slice 1 (Foundation), Slice 2 (Events)

## Scope

Full members feature: list (search + role/status filter), add a member (by
email, of an existing account — no user-creation flow exists), member
detail (profile fields + committee history), edit profile/status, change
role, remove. All five write actions live on one resource and are gated by
three distinct role tiers, so this ships as one cohesive slice rather than
split further.

Out of scope: self-service profile editing (there is no `PATCH
.../members/me` endpoint — only a committee member with `MANAGE_MEMBERS`
can edit anyone's profile fields, including their own via the same
committee-only endpoint). This is a backend gap, not a frontend omission;
noted here so it isn't rediscovered as a bug later.

## Backend contract (verified against controller/service/schema/e2e, not assumed)

Base path `organizations/:orgId/members`, all routes `JwtAuthGuard` +
`TenantGuard`, writes additionally `RolesGuard`:

- `GET /` — `VIEW_MEMBERS` tier (`PRESIDENT, VICE_PRESIDENT, SECRETARY,
  TREASURER, EVENT_DIRECTOR, COMMITTEE` — identical set to `MANAGE_EVENTS`,
  already `isCommittee()`). Query params `status?`/`role?` filter
  server-side. Returns `Membership[]` including `user: {id, fullName,
  email}`, ordered `joinedAt asc`.
- `GET /me` — any org member, no role check. Returns the caller's own
  membership (with `user`) or `null`.
- `POST /` — `MANAGE_MEMBERS` tier (`PRESIDENT, VICE_PRESIDENT, SECRETARY,
  TREASURER, EVENT_DIRECTOR` — identical set to Slice 2's
  `canManageMembers()`). Body: email, role, and optional
  studentId/faculty/programme/intake/phone. 404 if no `User` account exists
  for that email. 409 on duplicate membership. 403 (escalation guard) if
  the actor holds `MANAGE_MEMBERS` but not `MANAGE_ROLES` and tries to
  assign `PRESIDENT`/`VICE_PRESIDENT`. **Response omits the `user`
  relation** (only the four other write/read endpoints include it) — the
  frontend must not rely on `user` being present in the POST response.
- `PATCH /:membershipId` — `MANAGE_MEMBERS` tier. Body: optional `status`
  (`ACTIVE`/`ALUMNI`) and the same optional profile fields as add. No
  `role` field — mass-assignment-safe by construction, not by convention.
- `PATCH /:membershipId/role` — `MANAGE_ROLES` tier (`PRESIDENT,
  VICE_PRESIDENT` only). Body: `role`. No-op (200, no audit row) if the new
  role equals the current one.
- `DELETE /:membershipId` — `MANAGE_ROLES` tier. Returns `{ removed: true
  }`.
- **No `GET /:membershipId`** — there is no single-member fetch endpoint.
  The detail page reads from the already-fetched list and looks up by id.
- **Last-active-president guardrail**: any write that would leave zero
  `ACTIVE` `PRESIDENT` memberships (status→non-ACTIVE, role away from
  PRESIDENT, or remove) throws `409 Organization must have at least one
  president`. Enforced on `PATCH`, `PATCH .../role`, and `DELETE` alike —
  the frontend surfaces this message verbatim wherever it can occur, it
  does not try to predict/prevent it client-side (the "is this the last
  active president" check requires the full list, and duplicating that
  logic client-side would drift from the backend's own serializable-
  transaction-guarded version).
- **Tenant isolation asymmetry** (already established pattern, confirmed
  again here): wrong org in the URL → `403` (`TenantGuard`, before the
  handler runs); right org, wrong/foreign membership id → `404` (service-
  level `findFirst` scoping fails to find the row). Both cases render the
  same generic "not found" UI — the distinction doesn't need surfacing to
  the user, only to a developer reading network logs.

Role enum (9 values, no ALUMNI): `PRESIDENT | VICE_PRESIDENT | SECRETARY |
TREASURER | EVENT_DIRECTOR | COMMITTEE | VOLUNTEER | PARTICIPANT | ADVISOR`.
Status enum (2 values): `ACTIVE | ALUMNI`.

## Data layer & type fixes

`types/api.ts`:
- `MembershipRole` currently includes `'ALUMNI'` — **removed**. It was
  never a valid backend role value (confirmed against
  `prisma/schema.prisma`'s `Role` enum); ALUMNI is a `MemberStatus` value,
  not a role. Any code that happened to check `role === 'ALUMNI'` was
  already dead/wrong and this fix makes that a type error instead of a
  silent no-op.
- `MyMembership.status` currently includes `'INACTIVE'` — **removed**, same
  reasoning (`MemberStatus` is `ACTIVE | ALUMNI` only, confirmed against
  the Prisma enum and `docs/database.md`).
- New `MemberStatus = 'ACTIVE' | 'ALUMNI'` type (currently inlined on
  `MyMembership`; promoted to a named type so `Member` can reuse it).
- New `Member` type: `id, userId, organizationId, role: MembershipRole,
  status: MemberStatus, studentId/faculty/programme/intake/phone: string |
  null, committeeHistory: { role: MembershipRole; until: string }[],
  joinedAt: string, user: { id: string; fullName: string; email: string }`.

`features/orgs/roles.ts` — one addition (both `isCommittee()` and
`canManageMembers()` already match `VIEW_MEMBERS`/`MANAGE_MEMBERS` exactly
and are reused unchanged):

```ts
export const MANAGE_ROLES_ROLES: MembershipRole[] = ['PRESIDENT', 'VICE_PRESIDENT'];
export function canManageRoles(role: MembershipRole): boolean {
  return MANAGE_ROLES_ROLES.includes(role);
}
```

`features/members/use-members.ts`: `useMembers(orgId, filters: {status?:
MemberStatus; role?: MembershipRole})` (query key includes the filters,
query string built from them — server-side filtering per the backend's own
query-param support), `useAddMember(orgId)`, `useUpdateMember(orgId,
membershipId)`, `useChangeRole(orgId, membershipId)`,
`useRemoveMember(orgId)`. All mutations invalidate the members list query
key (and `['org', orgId, 'membership', 'me']` when the caller edits their
own row, so the app shell / dashboard role-branch stays current if a
committee member changes their own role or status).

## List page (`/members`)

Search box: client-side substring match on `user.fullName`/`user.email`
(no backend text-search param — same "client-side is fine, collection is
bounded" reasoning as Slice 2's events list, just applied on top of the
already-filtered server response rather than the full unfiltered set).
Role filter and status filter: both drive `useMembers`'s query params
directly (server refetch on change, not client `useMemo`). "Add member"
button, `canManageMembers`-gated, → `/members/new`. Rows: name, email,
`MemberRoleBadge` (plain `outline` variant, no color-coding — role isn't a
success/failure signal the way event/registration status is),
`MemberStatusBadge` (semantic tokens: ACTIVE=success, ALUMNI=neutral),
joined date via `relativeTime(m.joinedAt)` (`features/dashboard/format.ts`,
already used for Slice 3's submitted-date column — same reasoning: a
joined date is more useful as "3mo ago" than an absolute calendar date in
a scannable list). Row click → `/members/:id`.

## Add member page (`/members/new`)

`canManageMembers`-gated redirect (mirrors `NewEventPage`'s
not-authorized-don't-show-a-dead-end-form pattern). Fields: email (text),
role (select, all 9 values), studentId/faculty/programme/intake/phone (all
optional text inputs). Zod schema validates email format and required
role client-side; everything else passes through as optional strings,
backend does the real validation. Top-level error banner surfaces backend
messages verbatim: 404 "No account for that email", 409 duplicate, 403
escalation-guard message. On success → `router.push('/members')` (not the
new member's detail page — the POST response has no `user` relation to
render, and there's no single-fetch endpoint to immediately backfill it;
redirecting to the list, which does refetch with `user` included, avoids a
half-populated detail page).

## Member detail page (`/members/:id`)

No `GET /:id` — reads from `useMembers(orgId, {})` (unfiltered) and
`.find(m => m.id === id)`. Not found (foreign id, removed member, or still
loading) → pending state while loading, "Member not found" (deliberately
generic, same vagueness as `EventNotFound`) once loaded and no match.

Shows: name, email, `MemberRoleBadge`, `MemberStatusBadge`, profile fields
(studentId/faculty/programme/intake/phone — blank ones omitted, not shown
as "—"), joined date, and a read-only "Committee history" list rendering
`committeeHistory` as "Was `<role>` until `<date>`" lines (empty state:
nothing rendered, not "No history yet" — a member with no role changes
isn't missing something).

Actions, each independently gated:
- **Edit** (`canManageMembers`) → `/members/:id/edit`.
- **Change role** (`canManageRoles`) — inline control: select next to a
  "Change role" button. Selecting a value and confirming opens a `Dialog`
  (mirrors `LifecycleActions`'s cancel/delete pattern); the dialog's
  wording is louder when the target role is PRESIDENT or VICE_PRESIDENT
  ("This will give `<name>` full org control." vs. a plain "Change
  `<name>`'s role to `<role>`?" for anything else). Applying calls
  `useChangeRole`; surfaces the 409 last-president message inline if it
  fires.
- **Remove** (`canManageRoles`) — button → `Dialog` confirm ("Remove
  `<name>` from this organization? This cannot be undone.") →
  `useRemoveMember` → `router.push('/members')` on success. Surfaces the
  409 last-president message inline (dialog stays open, doesn't redirect)
  if it fires.

## Edit page (`/members/:id/edit`)

`canManageMembers`-gated redirect. Reads the member the same
find-in-list way as the detail page (redirect to `/members` if not found
rather than rendering an edit form for nothing). Fields: status (select,
ACTIVE/ALUMNI), the five profile fields, seeded from the found member.
Submit → `useUpdateMember`. Surfaces the 409 last-president message inline
if marking the sole active President ALUMNI. On success →
`router.push('/members/' + id)`.

## Testing

Unit (Vitest): `canManageRoles` truth table (all 9 roles, only
PRESIDENT/VICE_PRESIDENT true — same shape as the existing
`isCommittee`/`canManageMembers` tests), add-member schema (valid email
required, role required, profile fields all optional), edit-member schema
(status enum, profile fields optional, no role/email fields present at
all — the schema itself should make a role/email typo a compile error, not
just a runtime no-op, mirroring the backend DTO's structural safety).

Live verification (Playwright against the real dev server, both themes):
add a member by email (an account created via a second registration, same
pattern as Slice 3's cross-account setup) → appears in the list → role
filter and status filter both correctly narrow the server response → open
detail page → edit profile fields, confirm they persist → change role with
the confirm dialog, confirm `committeeHistory` gained an entry → attempt to
demote the sole PRESIDENT (via status→ALUMNI, then via role change, then
via remove) → confirm the 409 guardrail message surfaces correctly in each
of the three places it can fire → remove a non-president member, confirm
redirect and list update → escalation-guard 403 as a SECRETARY-tier actor
attempting to add/promote to PRESIDENT.

## Non-negotiables carried over

Tenant isolation, RBAC (three tiers this slice — `VIEW_MEMBERS`/
`MANAGE_MEMBERS`/`MANAGE_ROLES` — all reused from existing backend groups,
no new group introduced), no personal data beyond what the API already
returns, audit trail is backend-only. No domain hue for Members per
`design.md`'s existing nav-items comment (Dashboard/Members/Settings stay
neutral, the seven-hue system isn't extended per-page) — role and status
badges both use semantic/neutral tokens only, matching the pattern
established for Events and Registrations.
