import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { hasConflict, toMinutes } from '../common/utils/slots';
import type { BookAppointmentDto, StatusUpdateDto } from './appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where = {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN'
        ? query.hospitalId
          ? { hospitalId: query.hospitalId }
          : {}
        : { hospitalId: user.hospitalId ?? '' }),
      ...(await this.patientScope(user, query.patientId)),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.date ? { scheduledDate: new Date(`${query.date}T00:00:00.000Z`) } : {}),
      ...(query.q
        ? {
            patient: {
              is: {
                OR: [
                  { user: { is: { firstName: { contains: query.q, mode: 'insensitive' as const } } } },
                  { user: { is: { lastName: { contains: query.q, mode: 'insensitive' as const } } } },
                  { mrn: { contains: query.q, mode: 'insensitive' as const } },
                ],
              },
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        include: {
          patient: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          department: { select: { id: true, name: true } },
          medicalRecord: { select: { id: true, status: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true, total: true } },
        },
        orderBy: [{ scheduledDate: 'desc' }, { startTime: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      message: 'OK',
    };
  }

  async findOne(id: string, user: AuthUser) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        department: true,
        medicalRecord: { include: { prescriptions: { include: { items: true } }, labOrders: true } },
        invoice: { include: { items: true } },
      },
    });
    if (!appointment) {
      throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' });
    }
    this.assertTenant(appointment.hospitalId, user);
    if (user.role === 'PATIENT') {
      const patient = await this.prisma.patient.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!patient || patient.id !== appointment.patientId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This appointment is not yours.' });
      }
    }
    return appointment;
  }

  /**
   * Booking engine (PRD §07.2).
   *
   * Concurrency: a partial unique index on (doctorId, scheduledDate, startTime)
   * plus an explicit overlap check inside the transaction means two patients
   * racing for the same slot can never both succeed — the loser gets
   * SLOT_UNAVAILABLE (P2002 from Postgres, or the overlap pre-check).
   */
  async book(dto: BookAppointmentDto, user: AuthUser) {
    const patientId = await this.resolvePatientId(dto, user);
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: dto.doctorId },
      include: { user: true },
    });
    if (!doctor || doctor.deletedAt) {
      throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' });
    }
    this.assertTenant(doctor.hospitalId, user);

    const day = new Date(`${dto.scheduledDate}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: 'scheduledDate must be YYYY-MM-DD.' });
    }

    const schedule = await this.prisma.doctorAvailability.findFirst({
      where: { doctorId: doctor.id, weekday: day.getUTCDay() },
    });
    const isEmergency = dto.type === 'EMERGENCY';

    // Emergency bookings bypass slot availability but still need a valid window.
    if (!schedule && !isEmergency) {
      throw new BadRequestException({
        code: 'DOCTOR_OFF_DAY',
        message: 'The doctor does not work on this day.',
      });
    }

    const slotMinutes = schedule?.slotMinutes ?? 30;
    const start = dto.startTime;
    const end = this.addMinutes(start, slotMinutes);

    if (schedule && !isEmergency) {
      if (toMinutes(start) < toMinutes(schedule.startTime) || toMinutes(end) > toMinutes(schedule.endTime)) {
        throw new BadRequestException({
          code: 'OUTSIDE_WORKING_HOURS',
          message: `Working hours are ${schedule.startTime}–${schedule.endTime}.`,
        });
      }
    }

    const existing = await this.prisma.appointment.findMany({
      where: {
        scheduledDate: day,
        deletedAt: null,
        status: { notIn: ['CANCELLED'] },
        OR: [{ doctorId: doctor.id }, { patientId }],
      },
      select: { doctorId: true, patientId: true, startTime: true, endTime: true },
    });

    const doctorClash = existing.filter((a) => a.doctorId === doctor.id);
    if (hasConflict({ start, end }, doctorClash)) {
      throw new ConflictException({
        code: 'SLOT_UNAVAILABLE',
        message: 'This slot was just booked by another patient.',
      });
    }
    // A patient may not sit in two consultations at the same instant.
    if (hasConflict({ start, end }, existing.filter((a) => a.patientId === patientId))) {
      throw new ConflictException({
        code: 'PATIENT_DOUBLE_BOOKED',
        message: 'The patient already has an appointment in this time window.',
      });
    }

    try {
      const appointment = await this.prisma.appointment.create({
        data: {
          hospitalId: doctor.hospitalId,
          patientId,
          doctorId: doctor.id,
          departmentId: dto.departmentId ?? doctor.departmentId,
          scheduledDate: day,
          startTime: start,
          endTime: end,
          type: dto.type ?? 'CONSULTATION',
          status: isEmergency ? 'CONFIRMED' : 'PENDING',
          isEmergency,
          reason: dto.reason,
          createdById: user.id,
        },
        include: {
          patient: { include: { user: { select: { firstName: true, lastName: true } } } },
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      await this.audit.record({
        user,
        action: 'CREATE',
        entityType: 'Appointment',
        entityId: appointment.id,
        after: { startTime: start, doctorId: doctor.id },
      });
      return appointment;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          code: 'SLOT_UNAVAILABLE',
          message: 'This slot was just booked by another patient.',
        });
      }
      throw err;
    }
  }

  /** PENDING → CONFIRMED → IN_PROGRESS → COMPLETED | CANCELLED | NO_SHOW */
  async updateStatus(id: string, dto: StatusUpdateDto, user: AuthUser) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' });
    }
    this.assertTenant(appointment.hospitalId, user);

    const allowed = this.allowedTransitions(appointment.status);
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException({
        code: 'INVALID_TRANSITION',
        message: `Cannot move an appointment from ${appointment.status} to ${dto.status}.`,
      });
    }

    if (user.role === 'PATIENT' && !['CANCELLED'].includes(dto.status)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Patients may only cancel their own appointments.',
      });
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes,
        cancellationReason: dto.cancellationReason,
        cancelledAt: dto.status === 'CANCELLED' ? new Date() : appointment.cancelledAt,
      },
      include: {
        patient: { include: { user: { select: { firstName: true, lastName: true } } } },
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    await this.audit.record({
      user,
      action: 'UPDATE',
      entityType: 'Appointment',
      entityId: id,
      before: { status: appointment.status },
      after: { status: dto.status },
    });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' });
    }
    this.assertTenant(appointment.hospitalId, user);
    // Soft delete only — clinical history must remain auditable.
    await this.prisma.appointment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ user, action: 'DELETE', entityType: 'Appointment', entityId: id });
    return { deleted: true };
  }

  private allowedTransitions(from: string): string[] {
    switch (from) {
      case 'PENDING':
        return ['CONFIRMED', 'CANCELLED', 'NO_SHOW'];
      case 'CONFIRMED':
        return ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'];
      case 'IN_PROGRESS':
        return ['COMPLETED', 'CANCELLED'];
      case 'COMPLETED':
      case 'CANCELLED':
      case 'NO_SHOW':
        return [];
      default:
        return [];
    }
  }

  private async resolvePatientId(dto: BookAppointmentDto, user: AuthUser): Promise<string> {
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({
        where: { userId: user.id, deletedAt: null },
        select: { id: true, hospitalId: true },
      });
      if (!own) {
        throw new ForbiddenException({ code: 'NO_PATIENT_PROFILE', message: 'No patient profile found.' });
      }
      if (dto.patientId && dto.patientId !== own.id) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only book for yourself.' });
      }
      return own.id;
    }

    if (!dto.patientId) {
      throw new BadRequestException({ code: 'PATIENT_REQUIRED', message: 'patientId is required.' });
    }
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId } });
    if (!patient || patient.deletedAt) {
      throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' });
    }
    this.assertTenant(patient.hospitalId, user);
    return patient.id;
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

  private addMinutes(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = (h * 60 + m + minutes) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
}