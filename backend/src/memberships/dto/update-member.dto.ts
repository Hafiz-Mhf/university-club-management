import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MemberStatus } from '@prisma/client';

export class UpdateMemberDto {
  @IsOptional() @IsEnum(MemberStatus) status?: MemberStatus;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() faculty?: string;
  @IsOptional() @IsString() programme?: string;
  @IsOptional() @IsString() intake?: string;
  @IsOptional() @IsString() phone?: string;
}
