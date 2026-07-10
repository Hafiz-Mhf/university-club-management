import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateEventDto {
  @IsString() @MinLength(2) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() venue?: string;
  @IsISO8601() startAt!: string;
  @IsISO8601() endAt!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}
