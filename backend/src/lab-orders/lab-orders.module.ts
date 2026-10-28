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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService, NotificationsGateway } from '../notifications/notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';

class CreateLabOrderDto {
  @IsString() patientId: string;
  @IsOptional() @IsString() medicalRecordId?: string;
  @IsArray() @ArrayMinSize(1) labTestIds: string[];
  @IsOptional() @IsEnum(['ROUTINE', 'URGENT', 'STAT'] as const) priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class ResultDto {
  @IsOptional() @IsNumber() resultValue?: number;
  @IsOptional() @IsString() @MaxLength(500) resultText?: string;
  @IsOptional() @IsString() resultFileUrl?: string;
}

class StatusDto {
  @IsEnum(['ORDERED', 'SAMPLE_COLLECTED', 'IN_PROCESS', 'REJECTED', 'CANCELLED'] as const)
  status: 'ORDERED' | 'SAMPLE_COLLECTED' | 'IN_PROCESS' | 'REJECTED' | 'CANCELLED';
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** Automatic flagging of out-of-range values (PRD §07.5 hint). */
export function flagResult(
  value: number | undefined,
  referenceMin: number | null,
  referenceMax: number | null,
): 'NORMAL' | 'LOW' | 'HIGH' | null {
  if (value === undefined || (referenceMin === null && referenceMax === null)) return null;
  if (referenceMin !== null && value < referenceMin) return 'LOW';
  if (referenceMax !== null && value > referenceMax) return 'HIGH';
  return 'NORMAL';
}

@Injectable()
export class LabOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async listTests(user: AuthUser, query: Record<string, string>) {
    const hospitalId = user.role === 'SUPER_ADMIN' ? query.hospitalId ?? undefined : user.hospitalId ?? undefined;
    return this.prisma.labTest.findMany({
      where: {
        isActive: true,
        ...(hospitalId ? { hospitalId } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async createTestCatalogue(body: Record<string, any>, user: AuthUser) {
    if (user.role === 'PATIENT' || user.role === 'DOCTOR') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not allowed to create tests.' });
    }
    const hospitalId = user.hospitalId;
    if (!hospitalId) {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'No hospital attached.' });
    }
    return this.prisma.labTest.create({
      data: {
        hospitalId,
        code: String(body.code ?? `T-${Date.now()}`),
        name: String(body.name ?? ''),
        category: String(body.category ?? 'GENERAL'),
        price: Number(body.price ?? 0),
        unit: body.unit ?? null,
        referenceMin: body.referenceMin ?? null,
        referenceMax: body.referenceMax ?? null,
        referenceText: body.referenceText ?? null,
      },
    });
  }

  async create(dto: CreateLabOrderDto, user: AuthUser) {
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId } });
    if (!patient) {
      throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' });
    }
    this.assertTenant(patient.hospitalId, user);

    const doctor = await this.prisma.doctor.findFirst({ where: { userId: user.id } });
    if (!doctor) {
      throw new ForbiddenException({ code: 'NOT_A_DOCTOR', message: 'Only doctors can order lab tests.' });
    }

    const tests = await this.prisma.labTest.findMany({
      where: { id: { in: dto.labTestIds }, hospitalId: patient.hospitalId },
    });
    if (tests.length !== dto.labTestIds.length) {
      throw new NotFoundException({ code: 'UNKNOWN_TEST', message: 'One or more lab tests are unknown.' });
    }

    const order = await this.prisma.labOrder.create({
      data: {
        hospitalId: patient.hospitalId,
        medicalRecordId: dto.medicalRecordId,
        patientId: patient.id,
        orderedById: doctor.id,
        priority: dto.priority ?? 'ROUTINE',
        notes: dto.notes,
        items: { create: tests.map((t) => ({ labTestId: t.id })) },
      },
      include: { items: { include: { labTest: true } }, patient: { include: { user: true } } },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'LabOrder',
      entityId: order.id,
      after: { tests: tests.length },
    });
    return order;
  }

  async list(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' }),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(await this.patientScope(user, query.myRecords === 'true')),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.labOrder.count({ where }),
      this.prisma.labOrder.findMany({
        where,
        include: {
          items: { include: { labTest: true } },
          patient: { include: { user: { select: { firstName: true, lastName: true } } } },
          orderedBy: { include: { user: { select: { firstName: true, lastName: true } } } },
          approvedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, message: 'OK' };
  }

  async findOne(id: string, user: AuthUser) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id },
      include: {
        items: { include: { labTest: true } },
        patient: { include: { user: true } },
        orderedBy: { include: { user: { select: { firstName: true, lastName: true } } } },
        medicalRecord: { select: { id: true, diagnosis: true } },
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found.' });
    }
    this.assertTenant(order.hospitalId, user);
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      if (!own || own.id !== order.patientId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This report is not yours.' });
      }
      if (order.status !== 'APPROVED') {
        throw new ForbiddenException({
          code: 'RESULT_NOT_APPROVED',
          message: 'The report is still under review.',
        });
      }
    }
    return order;
  }

  /** Lab technician uploads structured results; out-of-range values auto-flag. */
  async uploadResult(id: string, results: Array<{ itemId: string } & ResultDto>, user: AuthUser) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id },
      include: { items: { include: { labTest: true } } },
    });
    if (!order) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found.' });
    }
    this.assertTenant(order.hospitalId, user);
    if (['APPROVED', 'CANCELLED'].includes(order.status)) {
      throw new ForbiddenException({ code: 'ORDER_CLOSED', message: 'This order is already closed.' });
    }

    for (const entry of results) {
      const item = order.items.find((i) => i.id === entry.itemId);
      if (!item) {
        throw new NotFoundException({ code: 'ITEM_NOT_FOUND', message: 'Order item not found.' });
      }
      await this.prisma.labOrderItem.update({
        where: { id: entry.itemId },
        data: {
          resultValue: entry.resultValue,
          resultText: entry.resultText,
          resultFileUrl: entry.resultFileUrl,
          performedById: user.id,
          performedAt: new Date(),
          flag: flagResult(entry.resultValue, item.labTest.referenceMin, item.labTest.referenceMax),
        },
      });
    }

    const updated = await this.prisma.labOrder.update({
      where: { id },
      data: { status: 'IN_PROCESS' },
      include: { items: { include: { labTest: true } } },
    });
    await this.audit.record({ user, action: 'UPDATE', entityType: 'LabOrder', entityId: id, after: { status: 'IN_PROCESS' } });
    return updated;
  }

  async updateStatus(id: string, dto: StatusDto, user: AuthUser) {
    const order = await this.prisma.labOrder.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found.' });
    }
    this.assertTenant(order.hospitalId, user);
    return this.prisma.labOrder.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes ?? order.notes },
      include: { items: { include: { labTest: true } } },
    });
  }

  /** Senior technician / manager approves → the report becomes visible to patient + doctor. */
  async approve(id: string, user: AuthUser) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id },
      include: { items: { include: { labTest: true } }, patient: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found.' });
    }
    this.assertTenant(order.hospitalId, user);
    if (order.items.some((i) => i.resultValue === null && i.resultText === null && !i.resultFileUrl)) {
      throw new ForbiddenException({
        code: 'RESULTS_MISSING',
        message: 'Upload results for every test before approving.',
      });
    }

    const updated = await this.prisma.labOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
      include: { items: { include: { labTest: true } } },
    });

    const patientUser = await this.prisma.user.findUnique({
      where: { id: order.patient.userId },
      select: { id: true },
    });
    if (patientUser) {
      await this.notifications.emit(this.gateway, {
        userId: patientUser.id,
        hospitalId: order.hospitalId,
        type: 'LAB_REPORT_READY',
        title: 'Your lab report is ready',
        body: `${order.items.map((i) => i.labTest.name).join(', ')} — report approved.`,
        link: `/portal/lab/${order.id}`,
      });
    }

    await this.audit.record({ user, action: 'UPDATE', entityType: 'LabOrder', entityId: id, after: { status: 'APPROVED' } });
    return updated;
  }

  private async patientScope(user: AuthUser, mine: boolean) {
    if (!mine) return {};
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      return own ? { patientId: own.id } : { patientId: '__none__' };
    }
    return {};
  }

  private assertTenant(hospitalId: string, user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.hospitalId !== hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'You cannot access data from another hospital.' });
    }
  }
}

@ApiTags('lab')
@ApiBearerAuth('bearer')
@Controller()
export class LabOrdersController {
  constructor(private readonly lab: LabOrdersService) {}

  @Post('lab-tests')
  @Roles('DOCTOR', 'LAB_TECHNICIAN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Create lab tests' })
  createTest(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.lab.createTestCatalogue(body, user);
  }

  @Get('lab-tests')
  @ApiOperation({ summary: 'Lab test catalogue with reference ranges' })
  listTests(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.lab.listTests(user, query);
  }

  @Post('lab-orders')
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Order one or more lab tests for a patient' })
  create(@Body() dto: CreateLabOrderDto, @CurrentUser() user: AuthUser) {
    return this.lab.create(dto, user);
  }

  @Get('lab-orders')
  @ApiOperation({ summary: 'List lab orders' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.lab.list(user, query);
  }

  @Get('lab-orders/:id')
  @ApiOperation({ summary: 'Lab order with results' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.lab.findOne(id, user);
  }

  @Patch('lab-orders/:id/result')
  @Roles('LAB_TECHNICIAN')
  @ApiOperation({ summary: 'Upload structured results' })
  uploadResult(
    @Param('id') id: string,
    @Body() body: { items: Array<{ itemId: string } & ResultDto> },
    @CurrentUser() user: AuthUser,
  ) {
    return this.lab.uploadResult(id, body.items ?? [], user);
  }

  @Patch('lab-orders/:id/status')
  @Roles('LAB_TECHNICIAN', 'RECEPTIONIST', 'NURSE')
  @ApiOperation({ summary: 'Advance the lab workflow status' })
  status(@Param('id') id: string, @Body() dto: StatusDto, @CurrentUser() user: AuthUser) {
    return this.lab.updateStatus(id, dto, user);
  }

  @Post('lab-orders/:id/approve')
  @Roles('LAB_TECHNICIAN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Approve and release the report' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.lab.approve(id, user);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [LabOrdersController],
  providers: [LabOrdersService],
  exports: [LabOrdersService],
})
export class LabOrdersModule {}
