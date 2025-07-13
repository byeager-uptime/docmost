import { IsBoolean, IsString, IsOptional, IsArray, ValidateNested, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export enum DocusaurusSyncInterval {
  MANUAL = 'manual',
  HOURLY = 'hourly',
  DAILY = 'daily',
}

export class DocusaurusSpaceMappingDto {
  @IsString()
  spaceId: string;

  @IsString()
  categoryName: string;

  @IsNumber()
  position: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;
}

export class DocusaurusAutoSyncDto {
  @IsBoolean()
  enabled: boolean;

  @IsEnum(DocusaurusSyncInterval)
  interval: DocusaurusSyncInterval;
}

export class DocusaurusConfigDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  sitePath: string;

  @IsString()
  baseUrl: string;

  @IsOptional()
  @IsString()
  siteTitle?: string;

  @IsOptional()
  @IsString()
  landingPageId?: string;

  @ValidateNested()
  @Type(() => DocusaurusAutoSyncDto)
  autoSync: DocusaurusAutoSyncDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocusaurusSpaceMappingDto)
  spaceMappings: DocusaurusSpaceMappingDto[];
}

export class UpdateDocusaurusConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DocusaurusConfigDto)
  docusaurusConfig?: DocusaurusConfigDto;
}