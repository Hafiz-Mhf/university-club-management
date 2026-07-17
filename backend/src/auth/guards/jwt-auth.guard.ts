import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { isAccountConsentStale } from '../../pdpa/consent-status.util';
import { SKIP_CONSENT_CHECK_KEY } from '../decorators/skip-consent-check.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authorized = (await super.canActivate(context)) as boolean;
    if (!authorized) return false;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CONSENT_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest();
    const stale = await isAccountConsentStale(this.prisma, req.user.userId);
    if (stale) throw new ForbiddenException('Account consent must be renewed');
    return true;
  }
}
