import { OrgProvider } from '@/features/orgs/org-provider';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <div className="flex min-h-dvh flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <div className="flex flex-1 flex-col">{children}</div>
        </div>
      </div>
    </OrgProvider>
  );
}
