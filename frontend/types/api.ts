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

export type MembershipRole =
  | 'PRESIDENT'
  | 'VICE_PRESIDENT'
  | 'SECRETARY'
  | 'TREASURER'
  | 'EVENT_DIRECTOR'
  | 'COMMITTEE'
  | 'VOLUNTEER'
  | 'PARTICIPANT'
  | 'ADVISOR'
  | 'ALUMNI';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
}

export interface MyMembership {
  id: string;
  role: MembershipRole;
  status: 'ACTIVE' | 'INACTIVE' | 'ALUMNI';
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

export interface ConsentRecordItem {
  id: string;
  purpose: string;
  policyVersion: string;
  grantedAt: string;
}
