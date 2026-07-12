import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceTokenService } from './attendance-token.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceTokenService],
  exports: [AttendanceService, AttendanceTokenService],
})
export class AttendanceModule {}
