import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() faculty?: string;
  @IsOptional() @IsString() programme?: string;
  @IsOptional() @IsString() intake?: string;
  @IsOptional() @IsString() phone?: string;
}
