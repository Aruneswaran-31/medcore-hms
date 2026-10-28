import {
  BadRequestException,
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class CreateMedicineDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() genericName?: string;
  @IsEnum(['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'TOPICAL', 'DROPS', 'INHALER'] as const)
  form: 'TABLET' | 'CAPSULE' | 'SYRUP' | 'INJECTION' | 'TOPICAL' | 'DROPS' | 'INHALER';
  @IsOptional() @IsString() strength?: string;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
}

class CreateBatchDto {
  @IsString() batchNumber: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) manufacturedAt: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresAt: string;
  @IsInt() @Min(0) quantity: number;
  @IsNumber() @Min(0) unitCost: number;
  @IsNumber() @Min(0) mrp: number;
}

class DispenseDto {
  @IsString() prescriptionItemId: string;
  @IsInt() @Min(1) quantity: number;
}

export interface StockSummary {
  medicineId: string;
  name: string;
  form: string;
  available: number;
  reorderLevel: number;
  lowStock: boolean;
  expiredQuantity: number;
  earliestExpiry: string | null;
}

@Injectable()
export class MedicinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: Record<string, string>) {
    const hospitalId = user.role === 'SUPER_ADMIN' ? query.hospitalId ?? undefined : user.hospitalId ?? undefined;
    const medicines = await this.prisma.medicine.findMany({
      where: {
        isActive: true,
        ...(hospitalId ? { hospitalId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { genericName: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { batches: { orderBy: { expiresAt: 'asc' } } },
      orderBy: { name: 'asc' },
      take: 100,
    });

    const today = new Date();
    return medicines.map((medicine) => {
      const usable = medicine.batches.filter(
        (b) => b.quantity > 0 && new Date(b.expiresAt) > today && !b.quarantinedAt,
      );
      const expired = medicine.batches
        .filter((b) => new Date(b.expiresAt) <= today)
        .reduce((sum, b) => sum + b.quantity, 0);
      const available = usable.reduce((sum, b) => sum + b.quantity, 0);
      return {
        ...medicine,
        availableQuantity: available,
        expiredQuantity: expired,
        earliestExpiry: usable[0]?.expiresAt?.toISOString().slice(0, 10) ?? null,
        lowStock: available <= medicine.reorderLevel,
        batches: undefined,
      };
    });
  }

  async create(dto: CreateMedicineDto, user: AuthUser) {
    if (user.role === 'PATIENT' || user.role === 'DOCTOR') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not allowed to add medicines.' });
    }
    if (!user.hospitalId) {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'No hospital attached.' });
    }
    const existing = await this.prisma.medicine.findFirst({
      where: { hospitalId: user.hospitalId, name: dto.name, strength: dto.strength ?? null },
    });
    if (existing) {
      throw new BadRequestException({ code: 'MEDICINE_EXISTS', message: 'Medicine already exists.' });
    }
    return this.prisma.medicine.create({
      data: {
        hospitalId: user.hospitalId,
        name: dto.name,
        genericName: dto.genericName,
        form: dto.form,
        strength: dto.strength,
        reorderLevel: dto.reorderLevel ?? 50,
      },
    });
  }

  async addBatch(medicineId: string, dto: CreateBatchDto, user: AuthUser) {
    const medicine = await this.prisma.medicine.findUnique({ where: { id: medicineId } });
    if (!medicine) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Medicine not found.' });
    }
    this.assertTenant(medicine.hospitalId, user);
    if (new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException({
        code: 'ALREADY_EXPIRED',
        message: 'Cannot receive stock that has already expired.',
      });
    }
    const batch = await this.prisma.medicineBatch.create({
      data: {
        medicineId,
        hospitalId: medicine.hospitalId,
        batchNumber: dto.batchNumber,
        manufacturedAt: new Date(dto.manufacturedAt),
        expiresAt: new Date(dto.expiresAt),
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        mrp: dto.mrp,
      },
    });
    await this.audit.record({ user, action: 'CREATE', entityType: 'MedicineBatch', entityId: batch.id });
    return batch;
  }

  async alerts(user: AuthUser) {
    const scope =
      user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' };
    const [lowStock, expiring] = await Promise.all([
      this.prisma.medicine.findMany({
        where: { ...scope, isActive: true },
        include: { batches: { where: { quarantinedAt: null } } },
      }),
      this.prisma.medicineBatch.findMany({
        where: {
          ...scope,
          quarantinedAt: null,
          quantity: { gt: 0 },
          expiresAt: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        include: { medicine: { select: { name: true, form: true } } },
        orderBy: { expiresAt: 'asc' },
        take: 50,
      }),
    ]);

    const cutoff = new Date();
    const low = lowStock
      .map((m) => ({
        medicineId: m.id,
        name: m.name,
        form: m.form,
        reorderLevel: m.reorderLevel,
        available: m.batches
          .filter((b) => new Date(b.expiresAt) > cutoff)
          .reduce((s, b) => s + b.quantity, 0),
      }))
      .filter((m) => m.available <= m.reorderLevel);

    return {
      lowStock: low,
      expiring: expiring.map((b) => ({
        batchId: b.id,
        medicine: b.medicine.name,
        batchNumber: b.batchNumber,
        expiresAt: b.expiresAt,
        quantity: b.quantity,
      })),
    };
  }

  /**
   * FIFO dispensing (PRD §07.6): consume the oldest unexpired batch first.
   * Expired or quarantined stock raises a patient-safety validation error.
   */
  async dispense(dto: DispenseDto, user: AuthUser) {
    const item = await this.prisma.prescriptionItem.findUnique({
      where: { id: dto.prescriptionItemId },
      include: { prescription: true, medicine: { include: { batches: { orderBy: { expiresAt: 'asc' } } } } },
    });
    if (!item) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Prescription item not found.' });
    }
    this.assertTenant(item.prescription.hospitalId, user);
    if (user.role !== 'PHARMACIST' && user.role !== 'HOSPITAL_ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE', message: 'Only a pharmacist can dispense.' });
    }

    const today = new Date();
    const expired = item.medicine?.batches.filter(
      (b) => b.quantity > 0 && new Date(b.expiresAt) <= today && b.medicineId === item.medicineId,
    );
    const batches = (item.medicine?.batches ?? []).filter(
      (b) => b.quantity > 0 && new Date(b.expiresAt) > today && !b.quarantinedAt,
    );

    const stock = batches.reduce((sum, b) => sum + b.quantity, 0);
    if (stock < dto.quantity) {
      if (expired && expired.length > 0 && stock === 0) {
        throw new BadRequestException({
          code: 'ONLY_EXPIRED_STOCK',
          message: 'All remaining batches are expired and quarantined — restock before dispensing.',
        });
      }
      throw new BadRequestException({
        code: 'INSUFFICIENT_STOCK',
        message: `Only ${stock} unit(s) available.`,
      });
    }

    let remaining = dto.quantity;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      await this.prisma.medicineBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: take } },
      });
      remaining -= take;
    }

    const updated = await this.prisma.prescriptionItem.update({
      where: { id: item.id },
      data: { dispensedQty: { increment: dto.quantity } },
    });

    const siblings = await this.prisma.prescriptionItem.findMany({
      where: { prescriptionId: item.prescriptionId },
    });
    const allDone = siblings.every(
      (s) => s.id === item.id ? s.dispensedQty + dto.quantity >= s.quantity : s.dispensedQty >= s.quantity,
    );
    if (allDone) {
      await this.prisma.prescription.update({
        where: { id: item.prescriptionId },
        data: { status: 'DISPENSED', dispensedAt: new Date() },
      });
    }

    await this.audit.record({
      user,
      action: 'DISPENSE',
      entityType: 'PrescriptionItem',
      entityId: item.id,
      after: { quantity: dto.quantity },
    });
    return { item: updated, prescriptionDispensed: allDone };
  }

  private assertTenant(hospitalId: string, user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.hospitalId !== hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'You cannot access data from another hospital.' });
    }
  }
}

@ApiTags('medicines')
@ApiBearerAuth('bearer')
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Get()
  @Roles('PHARMACIST', 'DOCTOR', 'HOSPITAL_ADMIN', 'ACCOUNTANT', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Search pharmacy inventory with stock levels' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.medicines.list(user, query);
  }

  @Get('alerts')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Low-stock and expiring-batch alerts' })
  alerts(@CurrentUser() user: AuthUser) {
    return this.medicines.alerts(user);
  }

  @Post()
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Add a medicine to the formulary' })
  create(@Body() dto: CreateMedicineDto, @CurrentUser() user: AuthUser) {
    return this.medicines.create(dto, user);
  }

  @Post(':id/batches')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Receive a new stock batch' })
  addBatch(@Param('id') id: string, @Body() dto: CreateBatchDto, @CurrentUser() user: AuthUser) {
    return this.medicines.addBatch(id, dto, user);
  }
}

@ApiTags('pharmacy')
@ApiBearerAuth('bearer')
@Controller('dispense')
export class DispenseController {
  constructor(private readonly medicines: MedicinesService) {}

  @Post()
  @Roles('PHARMACIST')
  @ApiOperation({ summary: 'Dispense a prescription item (FIFO, expiry-safe)' })
  dispense(@Body() dto: DispenseDto, @CurrentUser() user: AuthUser) {
    return this.medicines.dispense(dto, user);
  }
}

@Module({
  controllers: [MedicinesController, DispenseController],
  providers: [MedicinesService],
  exports: [MedicinesService],
})
export class MedicinesModule {}
