import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'primaryColor must be a hex color like #2563eb' })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'secondaryColor must be a hex color like #1e293b' })
  secondaryColor?: string;
}
