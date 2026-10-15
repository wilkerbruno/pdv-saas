import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Roles('OWNER', 'MANAGER') @Get('summary')
  summary(@CurrentUser() u: AuthUser, @Query('from') from: string, @Query('to') to: string) {
    return this.reports.summary(u.tenantId, from, to);
  }
}
