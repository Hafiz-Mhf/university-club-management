import { IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpdateAchievementDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(1) title?: string;
  @ValidateIf((o) => o.description !== undefined) @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsInt() year?: number;
}
