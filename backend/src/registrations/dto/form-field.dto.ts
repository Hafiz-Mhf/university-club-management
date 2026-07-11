import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { FormFieldType } from '@prisma/client';

export class FormFieldDto {
  @IsString() @MinLength(1) label!: string;
  @IsEnum(FormFieldType) type!: FormFieldType;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsInt() @Min(0) order!: number;
}
