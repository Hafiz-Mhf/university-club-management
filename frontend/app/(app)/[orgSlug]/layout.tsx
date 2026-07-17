import { OrgProvider } from '@/features/orgs/org-provider';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return <OrgProvider>{children}</OrgProvider>;
}
