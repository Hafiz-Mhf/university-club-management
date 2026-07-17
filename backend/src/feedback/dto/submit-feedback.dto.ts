import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitFeedbackDto {
  @IsInt() @Min(0) @Max(10) npsScore!: number;
  @IsInt() @Min(1) @Max(5) contentRating!: number;
  @IsInt() @Min(1) @Max(5) organizationRating!: number;
  @IsInt() @Min(1) @Max(5) venueRating!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
