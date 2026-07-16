import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';
import { AssetCondition } from '@prisma/client';

export class UpdateAssetDto {
  @ValidateIf((o) => o.name !== undefined) @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
