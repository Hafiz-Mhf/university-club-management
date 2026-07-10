import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateEventDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(2) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() venue?: string;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}
