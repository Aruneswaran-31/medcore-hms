import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AppointmentType } from '@medcore/types';

export class BookAppointmentDto {
  @ApiProperty({ description: 'Patient id; omit when booking as a patient for yourself' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty()
  @IsString()
  doctorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiProperty({ example: '2025-04-18' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate: string;

  @ApiProperty({ example: '09:30' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiPropertyOptional({ enum: ['CONSULTATION', 'FOLLOW_UP', 'EMERGENCY'], default: 'CONSULTATION' })
  @IsOptional()
  @IsEnum(['CONSULTATION', 'FOLLOW_UP', 'EMERGENCY'] as const)
  type?: AppointmentType;

  @ApiPropertyOptional({ example: 'Fever for 3 days' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason?: string;
}

export class StatusUpdateDto {
  @ApiProperty({
    enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  })
  @IsEnum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)
  status: 'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cancellationReason?: string;
}