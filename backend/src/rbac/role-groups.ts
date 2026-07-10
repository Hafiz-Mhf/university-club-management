import { Role } from '@prisma/client';

export const MANAGE_MEMBERS: Role[] = ['PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR'];
export const MANAGE_EVENTS: Role[] = [...MANAGE_MEMBERS, 'COMMITTEE'];
export const VIEW_MEMBERS: Role[] = [...MANAGE_MEMBERS, 'COMMITTEE'];
export const MANAGE_ROLES: Role[] = ['PRESIDENT', 'VICE_PRESIDENT'];
