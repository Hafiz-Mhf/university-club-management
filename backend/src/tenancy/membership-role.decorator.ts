import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

// Returns the caller's per-org role, set on the request by TenantGuard.
export const MembershipRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Role =>
    ctx.switchToHttp().getRequest().membershipRole,
);
