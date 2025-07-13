import { IsBoolean, IsString, IsOptional, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class NavigationLinkDto {
  @IsString()
  label: string;

  @IsString()
  @IsUrl()
  url: string;

  @IsOptional()
  @IsBoolean()
  external?: boolean;
}

export class BrandingConfigDto {
  @IsOptional()
  @IsString()
  logo?: string; // URL or file path to logo

  @IsOptional()
  @IsString()
  siteName?: string; // Site name to display in header

  @IsOptional()
  @IsBoolean()
  hideSiteName?: boolean; // Whether to hide the site name when logo is present

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NavigationLinkDto)
  navigationLinks?: NavigationLinkDto[];

  @IsOptional()
  @IsBoolean()
  showDocmostBranding?: boolean; // Whether to show "Powered by Docmost" 
}

export class UpdateBrandingConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingConfigDto)
  brandingConfig?: BrandingConfigDto;
}