import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { FileCategory } from '@prisma/client';

export class UploadFileDto {
  @IsNotEmpty() @IsString() title!: string;
  @IsEnum(FileCategory) category!: FileCategory;
}
