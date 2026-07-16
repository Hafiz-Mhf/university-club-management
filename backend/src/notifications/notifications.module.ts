import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { MailerService } from './mailer.service';
import { NOTIFICATION_QUEUE } from './notifications.types';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  providers: [NotificationsService, NotificationsProcessor, MailerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
