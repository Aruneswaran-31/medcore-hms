import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class PrescriptionItemDto {
  @IsOptional() @IsString() medicineId?: string;
  @IsString() @MinLength(1) @MaxLength(120) medicineName: string;
  @IsOptional() @IsEnum(['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'TOPICAL', 'DROPS', 'INHALER'] as const)
  form?: 'TABLET' | 'CAPSULE' | 'SYRUP' | 'INJECTION' | 'TOPICAL' | 'DROPS' | 'INHALER';
  @IsString() @MinLength(1) @MaxLength(60) dosage: string;
  @IsEnum(['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS'] as const)
  frequency: 'OD' | 'BD' | 'TDS' | 'QID' | 'HS' | 'SOS';
  @IsInt() @Min(1) durationDays: number;
  @IsOptional() @IsInt() quantity?: number;
  @IsOptional() @IsString() @MaxLength(300) instructions?: string;
}

class CreatePrescriptionDto {
  @IsString() medicalRecordId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() signatureSvg?: string;
}

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreatePrescriptionDto, user: AuthUser) {
    const record = await this.prisma.medicalRecord.findUnique({
      where: { id: dto.medicalRecordId },
      include: { patient: true, appointment: true },
    });
    if (!record) {
      throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Medical record not found.' });
    }
    this.assertTenant(record.hospitalId, user);

    const doctor =
      user.role === 'DOCTOR'
        ? await this.prisma.doctor.findFirst({ where: { userId: user.id } })
        : await this.prisma.doctor.findUnique({ where: { id: record.doctorId } });
    if (!doctor) {
      throw new ForbiddenException({ code: 'NOT_A_DOCTOR', message: 'No prescribing doctor found.' });
    }

    const prescription = await this.prisma.prescription.create({
      data: {
        hospitalId: record.hospitalId,
        medicalRecordId: record.id,
        patientId: record.patientId,
        doctorId: doctor.id,
        notes: dto.notes,
        signatureSvg: dto.signatureSvg,
        items: {
          create: dto.items.map((item) => ({
            medicineId: item.medicineId,
            medicineName: item.medicineName,
            form: item.form ?? 'TABLET',
            dosage: item.dosage,
            frequency: item.frequency,
            durationDays: item.durationDays,
            quantity: item.quantity ?? this.defaultQuantity(item.frequency, item.durationDays),
            instructions: item.instructions,
          })),
        },
      },
      include: { items: true },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'Prescription',
      entityId: prescription.id,
      after: { items: dto.items.length },
    });
    return prescription;
  }

  async list(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' }),
      ...(await this.patientScope(user, query.patientId)),
      ...(query.status ? { status: query.status as any } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.prescription.count({ where }),
      this.prisma.prescription.findMany({
        where,
        include: {
          items: true,
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          patient: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, message: 'OK' };
  }

  async findOne(id: string, user: AuthUser) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        items: { include: { medicine: true } },
        doctor: { include: { user: true, hospital: true } },
        patient: { include: { user: true } },
        medicalRecord: true,
      },
    });
    if (!prescription) {
      throw new NotFoundException({ code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription not found.' });
    }
    this.assertTenant(prescription.hospitalId, user);
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      if (!own || own.id !== prescription.patientId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This prescription is not yours.' });
      }
    }
    return prescription;
  }

  /**
   * Printable prescription (hospital letterhead). Returns HTML so the browser's
   * Print → Save as PDF produces a signed copy; the production pipeline swaps
   * this for Puppeteer (PRD §07.4) without changing the route contract.
   */
  async render(id: string, user: AuthUser, res: Response) {
    const rx = await this.findOne(id, user);
    const rows = rx.items
      .map(
        (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${esc(item.medicineName)}</strong> (${esc(item.form)})<br/>
              <small>${esc(item.dosage ?? '')} — ${esc(item.frequency)} for ${item.durationDays} day(s)</small></td>
          <td>${item.quantity}</td>
          <td>${esc(item.instructions ?? '—')}</td>
        </tr>`,
      )
      .join('');

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Prescription ${esc(rx.id.slice(0, 8))}</title>
<style>
 body{font-family:Georgia,serif;color:#111;margin:40px;}
 header{border-bottom:3px solid #0f766e;padding-bottom:12px;margin-bottom:24px;}
 h1{margin:0;color:#0f766e;font-size:26px;}
 .meta{display:flex;justify-content:space-between;font-size:13px;color:#444;}
 table{width:100%;border-collapse:collapse;margin-top:24px;}
 th,td{border:1px solid #ddd;padding:8px 10px;font-size:13px;vertical-align:top;text-align:left;}
 th{background:#f0fdfa;}
 .sig{margin-top:56px;text-align:right;}
 .sig .name{border-top:1px solid #111;display:inline-block;padding-top:6px;min-width:220px;text-align:center;}
 footer{margin-top:40px;font-size:11px;color:#666;text-align:center;border-top:1px solid #eee;padding-top:10px;}
</style></head>
<body>
<header>
  <div class="meta"><span>${esc(rx.patient.user.firstName)} ${esc(rx.patient.user.lastName)} · MRN ${esc(rx.patient.mrn ?? '—')}</span>
  <span>${new Date(rx.issuedAt).toDateString()}</span></div>
  <h1>${esc(rx.doctor.hospital?.name ?? 'MedCore HMS')}</h1>
</header>
<p><strong>Prescribed by:</strong> Dr. ${esc(rx.doctor.user.firstName)} ${esc(rx.doctor.user.lastName)}
 — ${esc(rx.doctor.specialization)} (Lic. ${esc(rx.doctor.licenseNumber)})</p>
<p><strong>Diagnosis:</strong> ${esc(rx.medicalRecord.diagnosis ?? '—')}</p>
${rx.notes ? `<p><strong>Notes:</strong> ${esc(rx.notes)}</p>` : ''}
<table><thead><tr><th>#</th><th>Medicine</th><th>Qty</th><th>Instructions</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sig"><div class="name">Dr. ${esc(rx.doctor.user.firstName)} ${esc(rx.doctor.user.lastName)}</div>
<div style="font-size:12px;color:#666">Digitally issued · ${esc(rx.id)}</div></div>
<footer>MedCore HMS · This prescription is valid only with the hospital seal and doctor signature.</footer>
</body></html>`);
  }

  private defaultQuantity(frequency: string, days: number): number {
    const perDay: Record<string, number> = { OD: 1, BD: 2, TDS: 3, QID: 4, HS: 1, SOS: 1 };
    return (perDay[frequency] ?? 1) * days;
  }

  private async patientScope(user: AuthUser, patientId?: string) {
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      return own ? { patientId: own.id } : { patientId: '__none__' };
    }
    return patientId ? { patientId } : {};
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

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@ApiTags('prescriptions')
@ApiBearerAuth('bearer')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Post()
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Issue a prescription for an encounter' })
  create(@Body() dto: CreatePrescriptionDto, @CurrentUser() user: AuthUser) {
    return this.prescriptions.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List prescriptions' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.prescriptions.list(user, query);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Printable prescription (HTML → Save as PDF)' })
  pdf(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    return this.prescriptions.render(id, user, res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Prescription detail' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.prescriptions.findOne(id, user);
  }
}

@Module({
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
