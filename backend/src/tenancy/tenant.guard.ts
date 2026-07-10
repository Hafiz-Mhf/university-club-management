import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId = req.params?.orgId ?? req.headers['x-organization-id'];
    if (!orgId) throw new ForbiddenException('Organization not specified');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.userId, organizationId: orgId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('No access to this organization');
    }
    req.organizationId = orgId;
    req.membershipRole = membership.role;
    return true;
  }
}
