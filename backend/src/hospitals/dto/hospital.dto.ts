import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateHospitalDto {
  @ApiProperty({ example: 'Apollo MedCore Chennai' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'TN-HOSP-0042' })
  @IsString()
  licenseNumber: string;

  @ApiProperty({ example: 'chennai@medcore.io' })
  @IsString()
  @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  email: string;

  @ApiProperty({ example: '+914440001000' })
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  line1?: string;
}

export class UpdateHospitalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Super Admin only — marks the tenant verified' })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ enum: ['FREE', 'STANDARD', 'ENTERPRISE'] })
  @IsOptional()
  @IsString()
  subscriptionPlan?: 'FREE' | 'STANDARD' | 'ENTERPRISE';
}