'use client';

import { useRouter } from 'next/navigation';
import { LogOut, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useLogout } from '@/features/auth/use-auth';

export function UserMenu() {
  const router = useRouter();
  const logout = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex cursor-pointer items-center rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-primary">
            <UserRound className="size-4" />
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-danger focus:text-danger"
          onClick={() =>
            logout.mutate(undefined, { onSettled: () => router.replace('/login') })
          }
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
