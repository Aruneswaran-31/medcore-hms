import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import type { InvoiceItemType, PaymentMethod } from '@medcore/types';

export class InvoiceItemDto {
  @ApiProperty({ enum: ['CONSULTATION', 'LAB', 'PHARMACY', 'ROOM', 'OTHER'] })
  @IsEnum(['CONSULTATION', 'LAB', 'PHARMACY', 'ROOM', 'OTHER'] as const)
  itemType: InvoiceItemType;

  @ApiProperty({ example: 'General consultation' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Percentage, e.g. 18 for GST', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  labOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prescriptionId?: string;
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  patientId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ example: '2025-04-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;
}

export class PaymentDto {
  @ApiProperty({ example: 1250 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ enum: ['CARD', 'UPI', 'NETBANKING', 'CASH', 'INSURANCE'], default: 'CASH' })
  @IsOptional()
  @IsEnum(['CARD', 'UPI', 'NETBANKING', 'CASH', 'INSURANCE'] as const)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: ['STRIPE', 'RAZORPAY', 'CASH', 'INSURANCE'], default: 'CASH' })
  @IsOptional()
  @IsEnum(['STRIPE', 'RAZORPAY', 'CASH', 'INSURANCE'] as const)
  provider?: 'STRIPE' | 'RAZORPAY' | 'CASH' | 'INSURANCE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerReference?: string;
}