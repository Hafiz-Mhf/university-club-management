import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PdpaService } from './pdpa.service';

// User-level PDPA routes: cross-org by design, so no TenantGuard/RolesGuard.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class PdpaController {
  constructor(private readonly pdpa: PdpaService) {}

  @Get('consents')
  consents(@CurrentUser() user: { userId: string }) {
    return this.pdpa.consents(user.userId);
  }

  @Get('export')
  export(@CurrentUser() user: { userId: string }) {
    return this.pdpa.export(user.userId);
  }
}
