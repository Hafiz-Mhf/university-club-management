'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOrg } from '@/features/orgs/org-provider';
import { useOrgs } from '@/features/orgs/use-orgs';
import { cn } from '@/lib/utils';
import type { Organization } from '@/types/api';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Logo URLs are short-lived signed links, so an expired one must degrade to
 * initials rather than a broken image — AvatarImage only mounts once loaded.
 */
function OrgAvatar({ org, className }: { org: Organization; className?: string }) {
  return (
    <Avatar className={cn('size-8 rounded-md', className)}>
      {org.logoUrl && <AvatarImage src={org.logoUrl} alt={org.name} className="rounded-md" />}
      <AvatarFallback className="rounded-md bg-primary/10 text-xs font-semibold text-primary">
        {initials(org.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function OrgSwitcher() {
  const router = useRouter();
  const { org } = useOrg();
  const orgs = useOrgs();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent">
        <OrgAvatar org={org} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{org.name}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {orgs.data?.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onClick={() => router.push(`/${o.slug}`)}
            className="cursor-pointer"
          >
            <OrgAvatar org={o} className="size-5" />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.id === org.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/welcome')} className="cursor-pointer">
          <Plus className="size-4" />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
