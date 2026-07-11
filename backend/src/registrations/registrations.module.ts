import { Module } from '@nestjs/common';
import { RegistrationFormController } from './registration-form.controller';
import { RegistrationFormService } from './registration-form.service';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  controllers: [RegistrationFormController, RegistrationsController],
  providers: [RegistrationFormService, RegistrationsService],
  exports: [RegistrationFormService, RegistrationsService],
})
export class RegistrationsModule {}
