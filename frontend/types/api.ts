// Response shapes as shipped by the NestJS backend (see docs/security.md
// "As built" sections). Keep these in lockstep with the backend — they are
// hand-maintained, not generated.

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  consentStale: boolean;
}

export interface RegisteredUser {
  id: string;
  email: string;
}

// Mirrors backend prisma Role enum exactly — 9 values. ALUMNI is a
// MemberStatus, never a role (a stray 'ALUMNI' union member here was a
// real bug fixed in Slice 4).
export type MembershipRole =
  | 'PRESIDENT'
  | 'VICE_PRESIDENT'
  | 'SECRETARY'
  | 'TREASURER'
  | 'EVENT_DIRECTOR'
  | 'COMMITTEE'
  | 'VOLUNTEER'
  | 'PARTICIPANT'
  | 'ADVISOR';

export type MemberStatus = 'ACTIVE' | 'ALUMNI';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  socialLinks: Record<string, string> | null;
  advisors: string[] | null;
}

export interface MyMembership {
  id: string;
  role: MembershipRole;
  status: MemberStatus;
}

export interface DashboardSummary {
  kpis: {
    activeMembers: number;
    totalEvents: number;
    activeRegistrations: number;
    certificatesIssued: number;
  };
  upcomingEvents: {
    id: string;
    title: string;
    startAt: string;
    venue: string | null;
    registrationCount: number;
  }[];
  pendingApprovals: {
    id: string;
    eventId: string;
    eventTitle: string;
    userId: string;
    createdAt: string;
  }[];
  recentRegistrations: {
    id: string;
    eventId: string;
    eventTitle: string;
    userId: string;
    status: 'PENDING' | 'APPROVED' | 'WAITLISTED' | 'CANCELLED' | 'REJECTED';
    createdAt: string;
  }[];
  activityFeed: {
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    actorUserId: string | null;
    createdAt: string;
  }[];
}

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';

export interface Event {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  venue: string | null;
  startAt: string;
  endAt: string;
  capacity: number | null;
  bannerKey: string | null;
  status: EventStatus;
  requireFeedbackForCertificate: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RegistrationStatus = 'APPROVED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';

export interface Registration {
  id: string;
  eventId: string;
  organizationId: string;
  userId: string;
  answers: Record<string, string | string[]> | null;
  status: RegistrationStatus;
  consentRecordId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FormFieldType = 'TEXT' | 'TEXTAREA' | 'SELECT' | 'CHECKBOX';

export interface FormField {
  // Present on fields read back from GET (assigned by the backend on
  // save) — absent on fields still being edited client-side before the
  // first Save. Registration answers are keyed by this id, not by label:
  // full-replace PUT regenerates ids, so a re-saved form's old answers
  // become orphaned by design (backend behavior, not a frontend concern).
  id?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  order: number;
}

export interface RegistrationForm {
  id: string;
  eventId: string;
  organizationId: string;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
}

export interface ConsentRecordItem {
  id: string;
  purpose: string;
  policyVersion: string;
  grantedAt: string;
}

export type AttendanceStatus = 'REGISTERED' | 'PRESENT' | 'ABSENT';

export interface Attendance {
  id: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  status: AttendanceStatus;
  scannedAt: string | null;
  scannedBy: string | null;
  createdAt: string;
}

// GET .../attendance/me only — a freshly-signed, non-expiring token, never
// persisted server-side (no qrTokenHash column).
export interface MyAttendance extends Attendance {
  token: string;
}

export interface Certificate {
  id: string;
  eventId: string;
  organizationId: string;
  userId: string;
  storageKey: string;
  fileSizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

// GET .../certificates/me and GET .../certificates/:id/download only — a
// freshly-signed, 5-minute download URL, never persisted client-side.
export interface MyCertificate extends Certificate {
  downloadUrl: string;
}

export interface FeedbackResponse {
  id: string;
  organizationId: string;
  eventId: string;
  userId: string;
  npsScore: number;
  contentRating: number;
  organizationRating: number;
  venueRating: number;
  comment: string | null;
  createdAt: string;
}

export interface AgendaItem {
  topic: string;
  notes: string;
}

export interface ActionItem {
  task: string;
  owner: string | null;
}

export interface MeetingMinutes {
  id: string;
  title: string;
  meetingDate: string;
  attendeeMembershipIds: string[];
  agendaItems: AgendaItem[];
  actionItems: ActionItem[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export interface Asset {
  id: string;
  name: string;
  quantity: number;
  condition: AssetCondition;
  location: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type FileCategory = 'SOP' | 'REPORT' | 'FINANCIAL' | 'MEETING' | 'OTHER';

export interface OrgFile {
  id: string;
  title: string;
  category: FileCategory;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface PublicProfile {
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string | null;
  socialLinks: Record<string, string> | null;
  advisors: string[] | null;
  upcomingEvents: { id: string; title: string; startAt: string; endAt: string; venue: string | null }[];
}

export interface PublicGalleryPhoto {
  id: string;
  caption: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface GalleryPhoto {
  id: string;
  caption: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface PublicAchievement {
  id: string;
  title: string;
  description: string;
  year: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  year: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MemberStatus;
  studentId: string | null;
  faculty: string | null;
  programme: string | null;
  intake: string | null;
  phone: string | null;
  // null until the first role change (backend jsonb column defaults null,
  // entries prepended on each change).
  committeeHistory: { role: MembershipRole; until: string }[] | null;
  joinedAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
}
