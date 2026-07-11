import { Module } from '@nestjs/common';
import { RegistrationFormController } from './registration-form.controller';
import { RegistrationFormService } from './registration-form.service';

@Module({
  controllers: [RegistrationFormController],
  providers: [RegistrationFormService],
  exports: [RegistrationFormService],
})
export class RegistrationsModule {}
