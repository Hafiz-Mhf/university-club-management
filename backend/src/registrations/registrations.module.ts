import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { RegistrationFormController } from './registration-form.controller';
import { RegistrationFormService } from './registration-form.service';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [AttendanceModule],
  controllers: [RegistrationFormController, RegistrationsController],
  providers: [RegistrationFormService, RegistrationsService],
  exports: [RegistrationFormService, RegistrationsService],
})
export class RegistrationsModule {}
