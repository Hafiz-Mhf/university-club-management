import { IsNotEmpty, IsString } from 'class-validator';

export class UploadCertificateDto {
  @IsNotEmpty() @IsString() userId!: string;
}
