import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [NotificationsModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
