import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CERTIFICATE_QUEUE } from './generation/certificate-generation.types';
import { CertificateGenerationService } from './generation/certificate-generation.service';
import { CertificateGenerationProcessor } from './generation/certificate-generation.processor';
import { CertificatePdfService } from './generation/certificate-pdf.service';

@Module({
  imports: [StorageModule, NotificationsModule, BullModule.registerQueue({ name: CERTIFICATE_QUEUE })],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateGenerationService, CertificateGenerationProcessor, CertificatePdfService],
  exports: [CertificatesService, CertificateGenerationService],
})
export class CertificatesModule {}
