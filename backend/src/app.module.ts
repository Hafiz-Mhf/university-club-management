import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AuditModule } from './audit/audit.module';
import { MembershipsModule } from './memberships/memberships.module';
import { EventsModule } from './events/events.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CertificatesModule } from './certificates/certificates.module';
import { FeedbackModule } from './feedback/feedback.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PdpaModule } from './pdpa/pdpa.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FilesModule } from './files/files.module';
import { MinutesModule } from './minutes/minutes.module';
import { AssetsModule } from './assets/assets.module';
import { GalleryModule } from './gallery/gallery.module';
import { AchievementsModule } from './achievements/achievements.module';
import { HandoverModule } from './handover/handover.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicModule } from './public/public.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            password: redisUrl.password || undefined,
          },
        };
      },
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    EventsModule,
    RegistrationsModule,
    AttendanceModule,
    CertificatesModule,
    FeedbackModule,
    DashboardModule,
    PdpaModule,
    AnalyticsModule,
    FilesModule,
    MinutesModule,
    AssetsModule,
    GalleryModule,
    AchievementsModule,
    HandoverModule,
    NotificationsModule,
    PublicModule,
  ],
})
export class AppModule {}
