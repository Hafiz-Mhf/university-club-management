import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { StorageModule } from '../storage/storage.module';
import { EventsModule } from '../events/events.module';
import { GalleryModule } from '../gallery/gallery.module';
import { AchievementsModule } from '../achievements/achievements.module';

@Module({
  imports: [StorageModule, EventsModule, GalleryModule, AchievementsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
