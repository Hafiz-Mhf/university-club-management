import { IsObject, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsOptional() @IsObject() answers?: Record<string, string | string[]>;
}
