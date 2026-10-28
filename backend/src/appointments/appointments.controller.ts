import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { BookAppointmentDto, StatusUpdateDto } from './appointment.dto';

@ApiTags('appointments')
@ApiBearerAuth('bearer')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List appointments with filters and pagination' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.appointments.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Appointment detail with EMR, prescriptions and invoice' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.appointments.findOne(id, user);
  }

  @Post()
  @Roles('PATIENT', 'RECEPTIONIST', 'HOSPITAL_ADMIN', 'NURSE')
  @ApiOperation({ summary: 'Book a slot with conflict detection' })
  book(@Body() dto: BookAppointmentDto, @CurrentUser() user: AuthUser) {
    return this.appointments.book(dto, user);
  }

  @Patch(':id/status')
  @Roles('DOCTOR', 'RECEPTIONIST', 'HOSPITAL_ADMIN', 'NURSE', 'PATIENT')
  @ApiOperation({ summary: 'Advance the appointment status lifecycle' })
  updateStatus(@Param('id') id: string, @Body() dto: StatusUpdateDto, @CurrentUser() user: AuthUser) {
    return this.appointments.updateStatus(id, dto, user);
  }

  @Delete(':id')
  @Roles('RECEPTIONIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Soft-delete an appointment' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.appointments.remove(id, user);
  }
}