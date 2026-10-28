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
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import type { Role } from '@medcore/types';

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  password: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  role: Role;

  @IsOptional()
  @IsString()
  departmentId?: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: { q?: string; role?: string; page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' }),
      ...(query.role ? { role: query.role as Role } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          status: true,
          hospitalId: true,
          createdAt: true,
          lastLoginAt: true,
          doctor: { select: { id: true, specialization: true } },
          patient: {
            select: {
              id: true,
              mrn: true,
              dateOfBirth: true,
              gender: true,
              bloodGroup: true,
              allergies: true,
              insuranceProvider: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
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
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        hospitalId: true,
        emailVerifiedAt: true,
        createdAt: true,
        doctor: true,
        patient: true,
      },
    });
    if (!target) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (user.role !== 'SUPER_ADMIN' && target.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({
        code: 'TENANT_MISMATCH',
        message: 'You cannot view users from another hospital.',
      });
    }
    return target;
  }

  async create(dto: CreateUserDto, user: AuthUser) {
    const hospitalId = user.role === 'SUPER_ADMIN' ? undefined : user.hospitalId;
    if (!hospitalId && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'No hospital attached.' });
    }

    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ForbiddenException({ code: 'EMAIL_TAKEN', message: 'Email already registered.' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        hospitalId: hospitalId ?? (await this.firstHospital(user)),
        emailVerifiedAt: new Date(),
        doctor:
          dto.role === 'DOCTOR'
            ? {
                create: {
                  hospitalId: hospitalId ?? (await this.firstHospital(user)),
                  departmentId: dto.departmentId,
                  specialization: 'General Medicine',
                  licenseNumber: `LIC-${Date.now()}`,
                },
              }
            : undefined,
        patient:
          dto.role === 'PATIENT'
            ? {
                create: {
                  hospitalId: hospitalId ?? (await this.firstHospital(user)),
                  mrn: `MRN-${Date.now().toString().slice(-6)}`,
                },
              }
            : undefined,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        hospitalId: true,
        status: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'User',
      entityId: created.id,
      after: { email: created.email, role: created.role },
    });
    return created;
  }

  async update(id: string, dto: UpdateUserDto, user: AuthUser) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (user.role !== 'SUPER_ADMIN' && target.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant update denied.' });
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true },
    });
    await this.audit.record({ user, action: 'UPDATE', entityType: 'User', entityId: id, after: dto });
    return updated;
  }

  private async firstHospital(user: AuthUser): Promise<string> {
    if (user.hospitalId) return user.hospitalId;
    const hospital = await this.prisma.hospital.findFirst({ where: { deletedAt: null } });
    if (!hospital) throw new ForbiddenException({ code: 'NO_HOSPITAL', message: 'No hospital found.' });
    return hospital.id;
  }
}

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @ApiOperation({ summary: 'Paginated user directory (tenant-scoped)' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.users.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'User profile (self, or same-tenant staff)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.findOne(id, user);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Invite staff or register a patient' })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Update a user' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}