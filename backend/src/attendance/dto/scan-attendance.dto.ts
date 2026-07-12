import { IsNotEmpty, IsString } from 'class-validator';

export class ScanAttendanceDto {
  @IsNotEmpty() @IsString() token!: string;
}
