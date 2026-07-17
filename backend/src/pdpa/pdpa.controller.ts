import { Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipConsentCheck } from '../auth/decorators/skip-consent-check.decorator';
import { PdpaService } from './pdpa.service';

// User-level PDPA routes: cross-org by design, so no TenantGuard/RolesGuard.
// Exempt from the consent-staleness check (SkipConsentCheck) — a user who
// doesn't want to accept a new policy must still be able to see their
// consent history, export their data, delete their account, or renew
// consent itself, without being trapped by the very check this endpoint cures.
@Controller('me')
@UseGuards(JwtAuthGuard)
@SkipConsentCheck()
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

  @Post('consent')
  renewConsent(@CurrentUser() user: { userId: string }, @Req() req: Request) {
    return this.pdpa.renewConsent(user.userId, req.ip);
  }

  @Delete()
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: { userId: string }) {
    return this.pdpa.deleteAccount(user.userId);
  }
}
