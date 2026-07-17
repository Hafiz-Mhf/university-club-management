import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';

@Controller('organizations/:orgId/events/:eventId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Post()
  submit(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.feedback.submit(orgId, eventId, user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.feedback.findMine(orgId, eventId, user.userId);
  }
}
