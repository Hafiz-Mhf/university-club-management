import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { FormFieldDto } from './form-field.dto';

export class UpsertRegistrationFormDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields!: FormFieldDto[];
}
