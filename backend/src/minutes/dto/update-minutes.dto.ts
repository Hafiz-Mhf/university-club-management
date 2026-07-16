import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AgendaItemDto } from './agenda-item.dto';
import { ActionItemDto } from './action-item.dto';

export class UpdateMinutesDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(2) title?: string;
  @IsOptional() @IsISO8601() meetingDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attendeeMembershipIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto) agendaItems?: AgendaItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ActionItemDto) actionItems?: ActionItemDto[];
}
