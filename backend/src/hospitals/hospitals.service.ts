import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateHospitalDto, UpdateHospitalDto } from './dto/hospital.dto';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser) {
    // Tenancy: only SUPER_ADMIN sees the platform-wide list.
    if (user.role === 'SUPER_ADMIN') {
      return this.prisma.hospital.findMany({
        orderBy: { createdAt: 'desc' },
        include: { address: true, _count: { select: { users: true, doctors: true, patients: true } } },
      });
    }
    return this.prisma.hospital.findMany({
      where: { id: user.hospitalId ?? '', deletedAt: null },
      include: { address: true, _count: { select: { users: true, doctors: true, patients: true } } },
    });
  }

  async findOne(id: string, user: AuthUser) {
    this.assertAccess(id, user);
    const hospital = await this.prisma.hospital.findUnique({
      where: { id },
      include: { address: true, departments: true, _count: { select: { users: true, doctors: true, patients: true } } },
    });
    if (!hospital || hospital.deletedAt) {
      throw new NotFoundException({ code: 'HOSPITAL_NOT_FOUND', message: 'Hospital not found.' });
    }
    return hospital;
  }

  async create(dto: CreateHospitalDto, user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only a Super Admin can onboard a hospital.',
      });
    }
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const hospital = await this.prisma.hospital.create({
      data: {
        name: dto.name,
        slug,
        licenseNumber: dto.licenseNumber,
        email: dto.email,
        phone: dto.phone,
        address:
          dto.line1 || dto.city
            ? {
                create: {
                  line1: dto.line1 ?? '',
                  city: dto.city ?? '',
                  state: dto.state ?? '',
                  postalCode: dto.postalCode ?? '',
                },
              }
            : undefined,
      },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'Hospital',
      entityId: hospital.id,
      after: { name: hospital.name, slug: hospital.slug },
    });
    return hospital;
  }

  async update(id: string, dto: UpdateHospitalDto, user: AuthUser) {
    if (dto.isVerified !== undefined && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only a Super Admin can verify a hospital.',
      });
    }
    this.assertAccess(id, user);
    const existing = await this.prisma.hospital.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'HOSPITAL_NOT_FOUND', message: 'Hospital not found.' });
    }

    const hospital = await this.prisma.hospital.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      user,
      action: 'UPDATE',
      entityType: 'Hospital',
      entityId: id,
      before: { name: existing.name, isVerified: existing.isVerified },
      after: dto,
    });
    return hospital;
  }

  private assertAccess(hospitalId: string, user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (!user.hospitalId || user.hospitalId !== hospitalId) {
      throw new ForbiddenException({
        code: 'TENANT_MISMATCH',
        message: 'You cannot access data from another hospital.',
      });
    }
  }
}