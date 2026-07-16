import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AssetCondition } from '@prisma/client';

export class CreateAssetDto {
  @IsString() @MinLength(1) name!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
