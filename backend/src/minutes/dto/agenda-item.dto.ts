import { IsString, MinLength } from 'class-validator';

export class AgendaItemDto {
  @IsString() @MinLength(1) topic!: string;
  @IsString() @MinLength(1) notes!: string;
}
