import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().organizationId,
);
