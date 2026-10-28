import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class VitalsDto {
  @IsOptional() @IsNumber() bpSystolic?: number;
  @IsOptional() @IsNumber() bpDiastolic?: number;
  @IsOptional() @IsNumber() pulse?: number;
  @IsOptional() @IsNumber() temperature?: number;
  @IsOptional() @IsNumber() spo2?: number;
  @IsOptional() @IsNumber() heightCm?: number;
  @IsOptional() @IsNumber() weightKg?: number;
  @IsOptional() @IsNumber() respiratoryRate?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class CreateRecordDto {
  @IsString()
  appointmentId: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) chiefComplaint?: string;
  @IsOptional() @IsString() @MaxLength(1000) presentingSymptoms?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;

  @IsOptional() @IsString() @MaxLength(500) diagnosis?: string;
  @IsOptional() @IsString() @MaxLength(20) icd10Code?: string;
  @IsOptional() @IsString() @MaxLength(500) differentialDiagnosis?: string;
  @IsOptional() @IsString() @MaxLength(2000) treatmentPlan?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) allergies?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) familyHistory?: string[];
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateRecordDto {
  @IsOptional() @IsString() @MaxLength(500) diagnosis?: string;
  @IsOptional() @IsString() @MaxLength(20) icd10Code?: string;
  @IsOptional() @IsString() @MaxLength(2000) treatmentPlan?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsObject() vitals?: VitalsDto;
  @IsOptional() @IsEnum(['DRAFT', 'FINALIZED'] as const) status?: 'DRAFT' | 'FINALIZED';
}

/** BMI is derived, never trusted from the client. */
export function calculateBmi(heightCm?: number, weightKg?: number): number | undefined {
  if (!heightCm || !weightKg || heightCm <= 0) return undefined;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

@Injectable()
export class MedicalRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateRecordDto, user: AuthUser) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      include: { medicalRecord: { select: { id: true } } },
    });
    if (!appointment) {
      throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' });
    }
    this.assertTenant(appointment.hospitalId, user);
    if (appointment.medicalRecord) {
      throw new NotFoundException({
        code: 'RECORD_EXISTS',
        message: 'An encounter record already exists for this appointment.',
      });
    }

    const doctor =
      user.role === 'DOCTOR' ? await this.ownDoctorId(user) : appointment.doctorId;
    const vitals = dto.vitals
      ? ({ ...dto.vitals, bmi: calculateBmi(dto.vitals.heightCm, dto.vitals.weightKg) } as Prisma.InputJsonValue)
      : undefined;

    const record = await this.prisma.medicalRecord.create({
      data: {
        hospitalId: appointment.hospitalId,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: doctor,
        chiefComplaint: dto.chiefComplaint,
        presentingSymptoms: dto.presentingSymptoms,
        vitals,
        diagnosis: dto.diagnosis,
        icd10Code: dto.icd10Code,
        differentialDiagnosis: dto.differentialDiagnosis,
        treatmentPlan: dto.treatmentPlan,
        allergies: dto.allergies ?? [],
        familyHistory: dto.familyHistory ?? [],
        notes: dto.notes,
      },
      include: { patient: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'IN_PROGRESS' },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'MedicalRecord',
      entityId: record.id,
      after: { diagnosis: dto.diagnosis ?? null },
    });
    return record;
  }

  async listForPatient(patientId: string, user: AuthUser) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' });
    }
    this.assertTenant(patient.hospitalId, user);
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      if (!own || own.id !== patientId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You may only view your own medical records.',
        });
      }
    }

    return this.prisma.medicalRecord.findMany({
      where: { patientId, hospitalId: patient.hospitalId },
      include: {
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        prescriptions: { include: { items: true } },
        labOrders: { include: { items: { include: { labTest: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        patient: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        appointment: true,
        prescriptions: { include: { items: true } },
        labOrders: { include: { items: { include: { labTest: true } } } },
      },
    });
    if (!record) {
      throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Medical record not found.' });
    }
    this.assertTenant(record.hospitalId, user);
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      if (!own || own.id !== record.patientId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied.' });
      }
    }
    return record;
  }

  /**
   * EMR is append-only: doctors can add/revise notes but records are never
   * deleted, and FINALIZED records become read-only (PRD §07.3).
   */
  async update(id: string, dto: UpdateRecordDto, user: AuthUser) {
    const record = await this.prisma.medicalRecord.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Medical record not found.' });
    }
    this.assertTenant(record.hospitalId, user);
    if (record.status === 'FINALIZED' && dto.status !== 'FINALIZED') {
      throw new ForbiddenException({
        code: 'RECORD_FINALIZED',
        message: 'Finalized records are read-only; add an addendum instead.',
      });
    }

    const data: Record<string, unknown> = {
      ...dto,
      finalizedAt: dto.status === 'FINALIZED' && !record.finalizedAt ? new Date() : record.finalizedAt,
    };
    if (dto.vitals) data.vitals = dto.vitals as unknown as Prisma.InputJsonValue;

    const updated = await this.prisma.medicalRecord.update({
      where: { id },
      data: data as any,
      include: { patient: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });

    await this.audit.record({
      user,
      action: 'UPDATE',
      entityType: 'MedicalRecord',
      entityId: id,
      after: { status: updated.status, diagnosis: updated.diagnosis },
    });
    return updated;
  }

  private async ownDoctorId(user: AuthUser): Promise<string> {
    const doctor = await this.prisma.doctor.findFirst({ where: { userId: user.id } });
    if (!doctor) {
      throw new ForbiddenException({
        code: 'NOT_A_DOCTOR',
        message: 'Your account is not linked to a doctor profile.',
      });
    }
    return doctor.id;
  }

  private assertTenant(hospitalId: string, user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.hospitalId !== hospitalId) {
      throw new ForbiddenException({
        code: 'TENANT_MISMATCH',
        message: 'You cannot access data from another hospital.',
      });
    }
  }
}

@ApiTags('medical-records')
@ApiBearerAuth('bearer')
@Controller('medical-records')
export class MedicalRecordsController {
  constructor(private readonly records: MedicalRecordsService) {}

  @Post()
  @Roles('DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Open an encounter record for an appointment' })
  create(@Body() dto: CreateRecordDto, @CurrentUser() user: AuthUser) {
    return this.records.create(dto, user);
  }

  @Get('patient/:patientId')
  @Roles('DOCTOR', 'NURSE', 'RECEPTIONIST', 'PATIENT', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Timeline of records for one patient' })
  forPatient(@Param('patientId') patientId: string, @CurrentUser() user: AuthUser) {
    return this.records.listForPatient(patientId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full encounter record' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.records.findOne(id, user);
  }

  @Patch(':id')
  @Roles('DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Amend an open record or finalize it' })
  update(@Param('id') id: string, @Body() dto: UpdateRecordDto, @CurrentUser() user: AuthUser) {
    return this.records.update(id, dto, user);
  }
}

@Module({
  controllers: [MedicalRecordsController],
  providers: [MedicalRecordsService],
  exports: [MedicalRecordsService],
})
export class MedicalRecordsModule {}