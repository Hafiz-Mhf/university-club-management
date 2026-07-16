import { IsOptional, IsString, MinLength } from 'class-validator';

export class ActionItemDto {
  @IsString() @MinLength(1) task!: string;
  @IsOptional() @IsString() owner?: string;
}
