import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogController } from './audit-log.controller';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
