import { IsInt, IsString, MinLength } from 'class-validator';

export class CreateAchievementDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) description!: string;
  @IsInt() year!: number;
}
