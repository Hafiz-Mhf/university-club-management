import {
  Award,
  CalendarDays,
  ChartNoAxesCombined,
  FolderOpen,
  LayoutDashboard,
  MessageSquareHeart,
  QrCode,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  /** Appended to /[orgSlug]; '' is the org root (dashboard). */
  segment: string;
  icon: LucideIcon;
  /**
   * Domain-hue text class for the icon (design.md hue map). Items without a
   * domain (Dashboard, Members, Settings) stay neutral — the hue system
   * covers exactly seven domains and is not extended per-page.
   */
  iconClass?: string;
  minTier: 'member' | 'committee';
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', segment: '', icon: LayoutDashboard, minTier: 'member' },
  { label: 'Events', segment: 'events', icon: CalendarDays, iconClass: 'text-domain-events', minTier: 'member' },
  { label: 'Members', segment: 'members', icon: Users, minTier: 'committee' },
  { label: 'Attendance', segment: 'attendance', icon: QrCode, iconClass: 'text-domain-attendance', minTier: 'member' },
  { label: 'Certificates', segment: 'certificates', icon: Award, iconClass: 'text-domain-certificates', minTier: 'member' },
  { label: 'Feedback', segment: 'feedback', icon: MessageSquareHeart, iconClass: 'text-domain-feedback', minTier: 'member' },
  { label: 'Analytics', segment: 'analytics', icon: ChartNoAxesCombined, iconClass: 'text-domain-analytics', minTier: 'committee' },
  { label: 'Workspace', segment: 'workspace', icon: FolderOpen, iconClass: 'text-domain-ops', minTier: 'committee' },
  { label: 'Settings', segment: 'settings', icon: Settings, minTier: 'member' },
];
