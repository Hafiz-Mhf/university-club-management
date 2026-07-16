import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsString, MinLength, ValidateNested } from 'class-validator';
import { AgendaItemDto } from './agenda-item.dto';
import { ActionItemDto } from './action-item.dto';

export class CreateMinutesDto {
  @IsString() @MinLength(2) title!: string;
  @IsISO8601() meetingDate!: string;
  @IsArray() @IsString({ each: true }) attendeeMembershipIds!: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto) agendaItems!: AgendaItemDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ActionItemDto) actionItems!: ActionItemDto[];
}
