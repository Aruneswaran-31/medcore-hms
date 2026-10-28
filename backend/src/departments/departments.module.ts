import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Injectable, Module, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class DepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser, hospitalId?: string) {
    const scopedId = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    return this.prisma.department.findMany({
      where: { hospitalId: scopedId ?? '', },
      orderBy: { name: 'asc' },
      include: { _count: { select: { doctors: true, appointments: true } } },
    });
  }

  async create(hospitalId: string, dto: DepartmentDto, user: AuthUser) {
    this.assertAccess(hospitalId, user);
    const exists = await this.prisma.department.findFirst({
      where: { hospitalId, code: dto.code },
    });
    if (exists) {
      throw new ForbiddenException({
        code: 'DEPARTMENT_EXISTS',
        message: `Department code ${dto.code} already exists in this hospital.`,
      });
    }
    return this.prisma.department.create({ data: { hospitalId, ...dto } });
  }

  async update(id: string, dto: DepartmentDto, user: AuthUser) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Department not found.' });
    }
    this.assertAccess(department.hospitalId, user);
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthUser) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { doctors: true } } },
    });
    if (!department) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Department not found.' });
    }
    this.assertAccess(department.hospitalId, user);
    if (department._count.doctors > 0) {
      throw new ForbiddenException({
        code: 'DEPARTMENT_IN_USE',
        message: 'Move the department doctors before deleting it.',
      });
    }
    await this.prisma.department.delete({ where: { id } });
    return { deleted: true };
  }

  private assertAccess(hospitalId: string, user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.hospitalId !== hospitalId) {
      throw new ForbiddenException({
        code: 'TENANT_MISMATCH',
        message: 'You cannot modify another hospital.',
      });
    }
  }
}

@ApiTags('departments')
@ApiBearerAuth('bearer')
@Controller('hospitals/:hospitalId/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Departments of a hospital' })
  list(@Param('hospitalId') hospitalId: string, @CurrentUser() user: AuthUser) {
    return this.departments.list(user, hospitalId);
  }

  @Post()
  @Roles('HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Create a department' })
  create(
    @Param('hospitalId') hospitalId: string,
    @Body() dto: DepartmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.departments.create(hospitalId, dto, user);
  }

  @Patch(':id')
  @Roles('HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Update a department' })
  update(@Param('id') id: string, @Body() dto: DepartmentDto, @CurrentUser() user: AuthUser) {
    return this.departments.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Delete an empty department' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.departments.remove(id, user);
  }
}

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}