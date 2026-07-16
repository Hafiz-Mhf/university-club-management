import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AuditModule } from './audit/audit.module';
import { MembershipsModule } from './memberships/memberships.module';
import { EventsModule } from './events/events.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CertificatesModule } from './certificates/certificates.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PdpaModule } from './pdpa/pdpa.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FilesModule } from './files/files.module';
import { MinutesModule } from './minutes/minutes.module';
import { AssetsModule } from './assets/assets.module';
import { GalleryModule } from './gallery/gallery.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    EventsModule,
    RegistrationsModule,
    AttendanceModule,
    CertificatesModule,
    DashboardModule,
    PdpaModule,
    AnalyticsModule,
    FilesModule,
    MinutesModule,
    AssetsModule,
    GalleryModule,
  ],
})
export class AppModule {}
