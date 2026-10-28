import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Role } from '@medcore/types';

export class RegisterDto {
  @ApiProperty({ example: 'arun@medcore.io' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Passw0rd!123' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an upper-case letter, a lower-case letter and a digit.',
  })
  password: string;

  @ApiProperty({ example: 'Arun' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName: string;

  @ApiProperty({ example: 'Kumar' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: ['PATIENT', 'DOCTOR'], default: 'PATIENT' })
  @IsOptional()
  @IsString()
  role?: Role;

  @ApiPropertyOptional({ description: 'Tenant hospital id; falls back to the demo hospital' })
  @IsOptional()
  @IsString()
  hospitalId?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'arun@medcore.io' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit code.' })
  otp: string;

  @ApiProperty({ example: 'arun@medcore.io' })
  @IsEmail()
  email: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/)
  otp: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'arun@medcore.io' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an upper-case letter, a lower-case letter and a digit.',
  })
  password: string;

  @ApiProperty()
  @IsString()
  token: string;
}