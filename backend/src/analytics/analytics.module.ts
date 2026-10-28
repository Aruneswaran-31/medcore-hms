import { Controller, ForbiddenException, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private hospitalIdFor(user: AuthUser, override?: string): string {
    if (user.role === 'SUPER_ADMIN') return override ?? user.hospitalId ?? '';
    if (override && override !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant analytics denied.' });
    }
    return user.hospitalId ?? '';
  }

  /** `''` scope means "every hospital" — never send an empty string to a UUID column. */
  private tenantFilter(scope: string): { hospitalId?: string } {
    return scope ? { hospitalId: scope } : {};
  }

  /** KPI cards for the admin dashboard (PRD §09). */
  async overview(user: AuthUser, hospitalId?: string) {
    const scope = this.hospitalIdFor(user, hospitalId);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [patientsToday, appointmentsToday, revenueToday, activeDoctors, lowStock, occupiedBeds] =
      await Promise.all([
        this.prisma.patient.count({
          where: { ...this.tenantFilter(scope), createdAt: { gte: startOfToday } },
        }),
        this.prisma.appointment.count({
          where: { ...this.tenantFilter(scope), scheduledDate: startOfToday, deletedAt: null },
        }),
        this.sumRevenue(scope, startOfToday, new Date()),
        this.prisma.doctor.count({ where: { ...this.tenantFilter(scope), deletedAt: null } }),
        this.lowStockCount(scope),
        this.prisma.appointment.count({
          where: { ...this.tenantFilter(scope), status: 'IN_PROGRESS', deletedAt: null },
        }),
      ]);

    return {
      patientsToday,
      appointmentsToday,
      revenueToday,
      activeDoctors,
      occupiedBeds,
      lowStockCount: lowStock,
    };
  }

  /** Daily revenue + invoice counts for the range chart. */
  async revenue(user: AuthUser, from?: string, to?: string, hospitalId?: string) {
    const scope = this.hospitalIdFor(user, hospitalId);
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 29 * 86400000);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();

    const rows = await this.prisma.invoice.findMany({
      where: {
        ...this.tenantFilter(scope),
        deletedAt: null,
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true, total: true },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<string, { revenue: number; invoices: number }>();
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? { revenue: 0, invoices: 0 };
      bucket.revenue += Number(row.total);
      bucket.invoices += 1;
      buckets.set(key, bucket);
    }

    return [...buckets.entries()].map(([date, value]) => ({
      date,
      revenue: Math.round(value.revenue * 100) / 100,
      invoices: value.invoices,
    }));
  }

  /** Appointment volume per day — bar chart on the admin dashboard. */
  async appointmentsByDay(user: AuthUser, days = 7, hospitalId?: string) {
    const scope = this.hospitalIdFor(user, hospitalId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const rows = await this.prisma.appointment.findMany({
      where: { ...this.tenantFilter(scope), scheduledDate: { gte: start }, deletedAt: null },
      select: { scheduledDate: true, status: true },
    });

    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const row of rows) {
      const key = row.scheduledDate.toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([date, count]) => ({ date, appointments: count }));
  }

  /** Department load — occupancy heat map. */
  async departments(user: AuthUser, hospitalId?: string) {
    const scope = this.hospitalIdFor(user, hospitalId);
    const departments = await this.prisma.department.findMany({
      where: this.tenantFilter(scope),
      include: { _count: { select: { doctors: true, appointments: true } } },
    });
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      doctors: d._count.doctors,
      appointments: d._count.appointments,
    }));
  }

  private async sumRevenue(hospitalId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.invoice.findMany({
      where: { ...this.tenantFilter(hospitalId), status: 'PAID', paidAt: { gte: from, lte: to } },
      select: { total: true },
    });
    return Math.round(rows.reduce((sum, r) => sum + Number(r.total), 0) * 100) / 100;
  }

  private async lowStockCount(hospitalId: string): Promise<number> {
    const medicines = await this.prisma.medicine.findMany({
      where: { ...this.tenantFilter(hospitalId), isActive: true },
      include: { batches: { where: { quarantinedAt: null } } },
    });
    const today = new Date();
    return medicines.filter((m) => {
      const available = m.batches
        .filter((b) => new Date(b.expiresAt) > today)
        .reduce((sum, b) => sum + b.quantity, 0);
      return available <= m.reorderLevel;
    }).length;
  }
}

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles('HOSPITAL_ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'DOCTOR')
  @ApiOperation({ summary: 'Dashboard KPI cards' })
  overview(@CurrentUser() user: AuthUser, @Query('hospitalId') hospitalId?: string) {
    return this.analytics.overview(user, hospitalId);
  }

  @Get('revenue')
  @Roles('HOSPITAL_ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Daily revenue series' })
  revenue(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('hospitalId') hospitalId?: string,
  ) {
    return this.analytics.revenue(user, from, to, hospitalId);
  }

  @Get('appointments')
  @Roles('HOSPITAL_ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Appointment volume for the last N days' })
  appointments(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('hospitalId') hospitalId?: string,
  ) {
    return this.analytics.appointmentsByDay(user, Number(days) || 7, hospitalId);
  }

  @Get('departments')
  @Roles('HOSPITAL_ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Department occupancy' })
  departments(@CurrentUser() user: AuthUser, @Query('hospitalId') hospitalId?: string) {
    return this.analytics.departments(user, hospitalId);
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
