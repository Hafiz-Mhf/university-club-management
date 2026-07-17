// Rendering helpers for the dashboard's activity feed and KPI cards.

const ACTION_SENTENCES: Record<string, string> = {
  'organization.profile.update': 'updated the organization profile',
  'organization.settings.update': 'updated organization settings',
  'organization.logo.upload': 'uploaded a new logo',
  'organization.logo.delete': 'removed the logo',
  'organization.banner.upload': 'uploaded a new banner',
  'organization.banner.delete': 'removed the banner',
  'member.add': 'added a member',
  'member.status.change': "changed a member's status",
  'member.role.change': "changed a member's role",
  'member.remove': 'removed a member',
  'event.create': 'created an event',
  'event.update': 'updated an event',
  'event.publish': 'published an event',
  'event.complete': 'completed an event',
  'event.cancel': 'cancelled an event',
  'event.delete': 'deleted an event',
  'registration.create': 'registered for an event',
  'registration.cancel': 'cancelled a registration',
  'registration.reject': 'rejected a registration',
  'registration.promote': 'promoted a waitlisted registration',
  'form.upsert': 'updated a registration form',
  'form.delete': 'deleted a registration form',
  'attendance.scan': 'checked a participant in',
  'attendance.absent': 'marked a participant absent',
  'certificate.upload': 'uploaded a certificate',
  'certificate.generate': 'generated a certificate',
  'certificate.delete': 'deleted a certificate',
  'file.upload': 'uploaded a file',
  'file.delete': 'deleted a file',
  'minutes.create': 'added meeting minutes',
  'minutes.update': 'updated meeting minutes',
  'minutes.delete': 'deleted meeting minutes',
  'asset.create': 'added an asset',
  'asset.update': 'updated an asset',
  'asset.delete': 'removed an asset',
  'gallery.upload': 'added a gallery photo',
  'gallery.delete': 'removed a gallery photo',
  'achievement.create': 'added an achievement',
  'achievement.update': 'updated an achievement',
  'achievement.delete': 'removed an achievement',
  'feedback.submit': 'submitted event feedback',
  'handover.generate': 'generated a handover pack',
  'pdpa.export': 'exported their data',
  'pdpa.delete': 'deleted their account',
  'pdpa.consent.renew': 'renewed their consent',
};

export function auditActionSentence(action: string): string {
  return ACTION_SENTENCES[action] ?? action.split('.').join(' ');
}

export function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
