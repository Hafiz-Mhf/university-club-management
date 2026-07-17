import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [NotificationsModule, CertificatesModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
