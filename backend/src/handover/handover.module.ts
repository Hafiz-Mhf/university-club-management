import { Module } from '@nestjs/common';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { HandoverPdfService } from './handover-pdf.service';

@Module({
  controllers: [HandoverController],
  providers: [HandoverService, HandoverPdfService],
})
export class HandoverModule {}
