import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HospitalsService } from './hospitals.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateHospitalDto, UpdateHospitalDto } from './dto/hospital.dto';

@ApiTags('hospitals')
@ApiBearerAuth('bearer')
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @Get()
  @ApiOperation({ summary: 'List hospitals (tenant-scoped unless Super Admin)' })
  list(@CurrentUser() user: AuthUser) {
    return this.hospitals.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Hospital detail with counts' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.hospitals.findOne(id, user);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Onboard a new hospital tenant' })
  create(@Body() dto: CreateHospitalDto, @CurrentUser() user: AuthUser) {
    return this.hospitals.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update hospital configuration / verification' })
  update(@Param('id') id: string, @Body() dto: UpdateHospitalDto, @CurrentUser() user: AuthUser) {
    return this.hospitals.update(id, dto, user);
  }
}