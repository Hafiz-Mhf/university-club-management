'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

function base(orgId: string) {
  return `/organizations/${orgId}/analytics`;
}

export interface AnalyticsOverview {
  attendanceRate: number | null;
}

export interface AnalyticsCertificates {
  issued: number;
  downloaded: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface MemberGrowthPoint {
  date: string;
  cumulativeActive: number;
}

export interface AnalyticsTrends {
  registrationTrend: TrendPoint[];
  memberGrowth: MemberGrowthPoint[];
}

export interface DemographicGroup {
  value: string | null;
  count: number;
}

export interface AnalyticsDemographics {
  faculty: DemographicGroup[];
  programme: DemographicGroup[];
}

export interface CommitteeActivityRow {
  userId: string;
  fullName: string;
  role: string;
  actionCount: number;
}

export interface CommitteeActivity {
  data: CommitteeActivityRow[];
}

export interface FeedbackAggregateRow {
  eventId: string;
  responseCount: number;
  avgNpsScore: number;
  avgContentRating: number;
  avgOrganizationRating: number;
  avgVenueRating: number;
}

export interface AnalyticsFeedback {
  data: FeedbackAggregateRow[];
}

export interface FeedbackTrendPoint {
  date: string;
  responseCount: number;
  avgNpsScore: number | null;
  avgContentRating: number | null;
  avgOrganizationRating: number | null;
  avgVenueRating: number | null;
}

export interface AnalyticsFeedbackTrends {
  trend: FeedbackTrendPoint[];
}

export function useAnalyticsOverview(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'overview'],
    queryFn: () => api<AnalyticsOverview>(`${base(orgId)}/overview`),
  });
}

export function useAnalyticsCertificates(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'certificates'],
    queryFn: () => api<AnalyticsCertificates>(`${base(orgId)}/certificates`),
  });
}

export function useAnalyticsTrends(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'trends', days],
    queryFn: () => api<AnalyticsTrends>(`${base(orgId)}/trends?days=${days}`),
  });
}

export function useAnalyticsDemographics(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'demographics'],
    queryFn: () => api<AnalyticsDemographics>(`${base(orgId)}/demographics`),
  });
}

export function useCommitteeActivity(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'committee-activity', days],
    queryFn: () => api<CommitteeActivity>(`${base(orgId)}/committee-activity?days=${days}`),
  });
}

export function useAnalyticsFeedback(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'feedback'],
    queryFn: () => api<AnalyticsFeedback>(`${base(orgId)}/feedback`),
  });
}

export function useAnalyticsFeedbackTrends(orgId: string, days: number) {
  return useQuery({
    queryKey: ['org', orgId, 'analytics', 'feedback-trends', days],
    queryFn: () => api<AnalyticsFeedbackTrends>(`${base(orgId)}/feedback-trends?days=${days}`),
  });
}
