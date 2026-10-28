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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { deriveSlots } from '../common/utils/slots';
import type { WeeklySchedule } from '../common/utils/slots';

class CreateDoctorDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[\d\s-]{7,15}$/)
  phone?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  specialization: string;

  @IsString()
  licenseNumber: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @Min(0)
  consultationFee?: number;
}

class AvailabilitySlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @Matches(/^\d{2}:\d{2}$/)
  startTime: string;

  @Matches(/^\d{2}:\d{2}$/)
  endTime: string;

  @IsInt()
  @Min(5)
  @Max(240)
  slotMinutes: number;

  @IsOptional()
  @IsBoolean()
  isOffline?: boolean;
}

class AvailabilityDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
}

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthUser,
    query: { q?: string; specialisation?: string; departmentId?: string; hospitalId?: string },
  ) {
    const hospitalId =
      user.role === 'SUPER_ADMIN' ? query.hospitalId ?? undefined : user.hospitalId ?? undefined;

    const doctors = await this.prisma.doctor.findMany({
      where: {
        deletedAt: null,
        ...(hospitalId ? { hospitalId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.specialisation
          ? { specialization: { contains: query.specialisation, mode: 'insensitive' } }
          : {}),
        ...(query.q
          ? {
              OR: [
                { user: { is: { firstName: { contains: query.q, mode: 'insensitive' } } } },
                { user: { is: { lastName: { contains: query.q, mode: 'insensitive' } } } },
                { specialization: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true },
        },
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { appointments: true } },
      },
      orderBy: [{ user: { lastName: 'asc' } }],
    });
    return doctors;
  }

  async findOne(id: string, user: AuthUser) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        department: true,
        availability: { orderBy: { weekday: 'asc' } },
      },
    });
    if (!doctor) {
      throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' });
    }
    if (user.role !== 'SUPER_ADMIN' && doctor.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant access denied.' });
    }
    return doctor;
  }

  async create(dto: CreateDoctorDto, user: AuthUser) {
    if (user.role === 'PATIENT' || user.role === 'DOCTOR') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not allowed to create doctors.' });
    }
    const hospitalId = user.hospitalId ?? undefined;
    if (!hospitalId && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'No hospital attached to your account.' });
    }
    const tenantId = hospitalId ?? (await this.firstHospital());

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const hospitalUsers = await this.prisma.user.count({ where: { hospitalId: tenantId } });

    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: 'DOCTOR',
        hospitalId: tenantId,
        emailVerifiedAt: new Date(),
        doctor: {
          create: {
            hospitalId: tenantId,
            departmentId: dto.departmentId,
            specialization: dto.specialization,
            licenseNumber: dto.licenseNumber || `LIC-${hospitalUsers + 1}`,
            consultationFee: dto.consultationFee ?? 500,
          },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        doctor: true,
      },
    });
  }

  async getAvailability(doctorId: string, user: AuthUser) {
    await this.assertDoctorAccess(doctorId, user);
    return this.prisma.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: { weekday: 'asc' },
    });
  }

  /** Replaces the whole weekly schedule in one transaction (PRD §05 decision). */
  async setAvailability(doctorId: string, dto: AvailabilityDto, user: AuthUser) {
    await this.assertDoctorAccess(doctorId, user);
    await this.prisma.$transaction([
      this.prisma.doctorAvailability.deleteMany({ where: { doctorId } }),
      this.prisma.doctorAvailability.createMany({
        data: dto.slots.map((slot) => ({
          doctorId,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotMinutes: slot.slotMinutes,
          isOffline: slot.isOffline ?? false,
        })),
      }),
    ]);
    return this.prisma.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: { weekday: 'asc' },
    });
  }

  /** Derived free/busy slots for one date — powers the booking calendar. */
  async slotsForDate(doctorId: string, date: string, user: AuthUser) {
    await this.assertDoctorAccess(doctorId, user);
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      throw new NotFoundException({ code: 'INVALID_DATE', message: 'Expected YYYY-MM-DD.' });
    }

    const [schedule, appointments] = await Promise.all([
      this.prisma.doctorAvailability.findMany({ where: { doctorId, weekday: day.getUTCDay() } }),
      this.prisma.appointment.findMany({
        where: {
          doctorId,
          scheduledDate: day,
          deletedAt: null,
          status: { notIn: ['CANCELLED'] },
        },
        select: { startTime: true, endTime: true },
      }),
    ]);

    if (schedule.length === 0) return [];
    const weekly: WeeklySchedule = {
      weekday: day.getUTCDay(),
      startTime: schedule[0].startTime,
      endTime: schedule[0].endTime,
      slotMinutes: schedule[0].slotMinutes,
      isOffline: schedule[0].isOffline,
    };
    return deriveSlots(weekly, appointments.map((a) => a.startTime));
  }

  private async assertDoctorAccess(doctorId: string, user: AuthUser) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' });
    }
    if (user.role !== 'SUPER_ADMIN' && doctor.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant access denied.' });
    }
    return doctor;
  }

  private async firstHospital(): Promise<string> {
    const hospital = await this.prisma.hospital.findFirst({ where: { deletedAt: null } });
    if (!hospital) throw new ForbiddenException({ code: 'NO_HOSPITAL', message: 'No hospital found.' });
    return hospital.id;
  }
}

@ApiTags('doctors')
@ApiBearerAuth('bearer')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @ApiOperation({ summary: 'Search doctors by specialisation, department or name' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.doctors.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Doctor profile with weekly availability' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.doctors.findOne(id, user);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Onboard a doctor' })
  create(@Body() dto: CreateDoctorDto, @CurrentUser() user: AuthUser) {
    return this.doctors.create(dto, user);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Weekly repeating schedule' })
  availability(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.doctors.getAvailability(id, user);
  }

  @Put(':id/availability')
  @Roles('DOCTOR', 'HOSPITAL_ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Replace the weekly schedule' })
  setAvailability(
    @Param('id') id: string,
    @Body() dto: AvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.doctors.setAvailability(id, dto, user);
  }

  @Get(':id/slots')
  @ApiOperation({ summary: 'Free slots for a date (YYYY-MM-DD)' })
  slots(@Param('id') id: string, @Query('date') date: string, @CurrentUser() user: AuthUser) {
    return this.doctors.slotsForDate(id, date, user);
  }
}

@Module({
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}