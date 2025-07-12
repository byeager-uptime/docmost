import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { IsArray, IsBoolean, IsOptional, IsString, IsObject } from 'class-validator';
import { JsonValue } from '../../../database/types/db';

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {
  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsArray()
  emailDomains?: string[];

  @IsOptional()
  @IsBoolean()
  enforceSso?: boolean;

  @IsOptional()
  @IsObject()
  settings?: JsonValue;
}
