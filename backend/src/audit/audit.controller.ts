import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('audit')
@ApiBearerAuth('bearer')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Recent audit entries for the current tenant' })
  list(@CurrentUser() user: AuthUser, @Query('limit') limit = '50') {
    const take = Math.min(Number(limit) || 50, 200);
    return this.audit.listRecent(user, take);
  }
}